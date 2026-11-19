import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { QuizBankRepository } from '../ai/quiz/bank/quiz-bank.repository';
import { DomainException } from '../common/errors/domain.exception';
import {
  DeinflectCandidate,
  deinflectJapanese,
  deinflectJapaneseDetailed,
} from '../common/japanese/jp-deinflect';
import { PrismaService } from '../db/prisma.service';
import {
  assertLanguagesInProfile,
  profileLanguageIds,
} from '../users/profile-languages';
import { lockUser } from '../users/user-lock';
import { CollectionsService } from './collections.service';
import {
  CreateCollectionAndImportDto,
  ImportAddedItemDto,
  ImportItemsDto,
  ImportItemsResponseDto,
  ImportNotFoundItemDto,
  ImportSkippedDuplicateDto,
} from './dto/import-items.dto';
import {
  CanonicalPos,
  extractInlineWordMetadata,
  isKanaOnly,
  isSupportedImportSourceType,
  normalizeImportPos,
  normalizeImportReadings,
  normalizeKanaKey,
  toKatakanaKey,
} from './pos-normalizer';
import {
  ImportLexemeCandidate,
  ImportTopSenseRow,
  ItemImportLookupRepository,
} from './repositories/item-import-lookup.repository';

const IMPORT_TRANSACTION_TIMEOUT_MS = 30_000;
const MAX_POSITION = 2_147_483_647;
const SUPPORTED_STUDY_LANGUAGE_IDS = [1, 2] as const;

interface NormalizedInputRow {
  index: number;
  rawWord: string;
  word: string;
  lookupKeys: string[];
  kanaKey: string | null;
  rawPos: string | null;
  normalizedPos: CanonicalPos | null;
  readings: string[];
  note: string | null;
  supportedType: boolean;
}

interface ResolvedRow {
  input: NormalizedInputRow;
  sense: ImportTopSenseRow;
  posMatched: boolean;
  deinflectedFrom: string | null;
}

/**
 * M5.3 — Auto Import List vào sổ tay (1 bước):
 * Khớp mặt chữ + từ loại (+ tùy chọn cách đọc), chọn nghĩa phổ biến nhất (M10.5/M4.5),
 * tự ghi vào bộ có sẵn hoặc tạo bộ mới và trả rõ danh sách `not_found`.
 */
@Injectable()
export class ItemsImportService {
  private readonly logger = new Logger(ItemsImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lookupRepo: ItemImportLookupRepository,
    private readonly collectionsService: CollectionsService,
    @Optional() private readonly quizBankRepo?: QuizBankRepository,
  ) {}

  async importIntoCollection(
    userId: bigint,
    collectionId: string,
    dto: ImportItemsDto,
  ): Promise<ImportItemsResponseDto> {
    const owned = await this.prisma.collection.findFirst({
      where: { id: collectionId, ownerId: userId, archivedAt: null },
      select: { id: true, profileId: true, itemCount: true },
    });
    if (!owned) {
      throw new DomainException(
        'COLLECTION_NOT_FOUND',
        'Không tìm thấy bộ sưu tập',
        HttpStatus.NOT_FOUND,
      );
    }

    const profile = await this.findOwnedProfileOrThrow(userId, owned.profileId);
    const allowedLanguageIds = profileLanguageIds(
      profile.primaryLanguageId,
      profile.secondaryLanguageId,
    );

    const resolution = await this.resolveItems(dto.items, allowedLanguageIds);
    const status = dto.status ?? 'learning';
    const skippedDuplicates: ImportSkippedDuplicateDto[] = [
      ...resolution.duplicateInRequest,
    ];
    const added: ImportAddedItemDto[] = [];
    const insertedSenses: { senseId: bigint; languageId: number }[] = [];

    if (resolution.dedupedResolved.length > 0) {
      await this.prisma.$transaction(
        async (tx) => {
          await lockUser(tx, userId);

          const lockedCollection = await tx.collection.findFirst({
            where: { id: collectionId, ownerId: userId, archivedAt: null },
            select: { id: true, profileId: true },
          });
          if (!lockedCollection) {
            throw new DomainException(
              'COLLECTION_NOT_FOUND',
              'Không tìm thấy bộ sưu tập',
              HttpStatus.NOT_FOUND,
            );
          }

          const lockedProfile = await tx.studyProfile.findFirst({
            where: { id: lockedCollection.profileId, userId },
            select: {
              id: true,
              primaryLanguageId: true,
              secondaryLanguageId: true,
            },
          });
          if (!lockedProfile) {
            throw new DomainException(
              'PROFILE_NOT_FOUND',
              'Không tìm thấy hồ sơ học của bộ sưu tập',
              HttpStatus.CONFLICT,
            );
          }
          const lockedAllowed = profileLanguageIds(
            lockedProfile.primaryLanguageId,
            lockedProfile.secondaryLanguageId,
          );

          const existingRows = await tx.collectionItem.findMany({
            where: { collectionId },
            select: { anchorSenseId: true },
          });
          const existingSet = new Set(
            existingRows.map((row) => row.anchorSenseId.toString()),
          );

          const toInsert: ResolvedRow[] = [];
          for (const row of resolution.dedupedResolved) {
            if (existingSet.has(row.sense.sense_id.toString())) {
              skippedDuplicates.push({
                index: row.input.index,
                word: row.input.rawWord,
                sense_id: row.sense.sense_id.toString(),
                lemma: row.sense.lemma,
                reason: 'already_in_collection',
              });
            } else {
              toInsert.push(row);
            }
          }

          if (toInsert.length === 0) {
            return;
          }

          assertLanguagesInProfile(
            lockedAllowed,
            toInsert.map((row) => row.sense.language_id),
          );

          const aggregate = await tx.collectionItem.aggregate({
            where: { collectionId },
            _max: { position: true },
          });
          const startPosition = aggregate._max.position ?? 0;
          if (startPosition + toInsert.length > MAX_POSITION) {
            throw new DomainException(
              'COLLECTION_POSITION_LIMIT_REACHED',
              'Bộ sưu tập đã đạt giới hạn vị trí của item',
              HttpStatus.CONFLICT,
            );
          }

          const now = new Date();
          const prepared = toInsert.map((row, idx) => {
            const itemId = uuidv7();
            const faceId = uuidv7();
            return {
              row,
              item: {
                id: itemId,
                collectionId,
                conceptId: row.sense.concept_id,
                anchorSenseId: row.sense.sense_id,
                meaningVi: row.sense.meaning_vi,
                meaningSource: row.sense.meaning_source,
                note: row.input.note,
                status,
                position: startPosition + idx + 1,
              },
              face: {
                id: faceId,
                itemId,
                senseId: row.sense.sense_id,
                languageId: row.sense.language_id,
                role: 'primary',
              },
              srs: {
                faceId,
                userId,
                profileId: lockedCollection.profileId,
                state: 'new',
                dueAt: now,
              },
            };
          });

          await tx.collectionItem.createMany({
            data: prepared.map((entry) => entry.item),
          });
          await tx.collectionItemFace.createMany({
            data: prepared.map((entry) => entry.face),
          });
          await tx.srsState.createMany({
            data: prepared.map((entry) => entry.srs),
          });
          await tx.collection.update({
            where: { id: collectionId },
            data: { itemCount: { increment: prepared.length } },
          });

          for (const entry of prepared) {
            added.push(toAddedDto(entry.row, entry.item.id));
            insertedSenses.push({
              senseId: entry.row.sense.sense_id,
              languageId: entry.row.sense.language_id,
            });
          }
        },
        { timeout: IMPORT_TRANSACTION_TIMEOUT_MS },
      );
    }

    await this.prewarmQuizBank(insertedSenses, collectionId);
    const collection = await this.collectionsService.get(userId, collectionId);

    skippedDuplicates.sort((a, b) => a.index - b.index);
    return {
      collection,
      total_submitted: dto.items.length,
      added_count: added.length,
      skipped_duplicate_count: skippedDuplicates.length,
      not_found_count: resolution.notFound.length,
      added,
      skipped_duplicates: skippedDuplicates,
      not_found: resolution.notFound,
    };
  }

  async createCollectionAndImport(
    userId: bigint,
    dto: CreateCollectionAndImportDto,
  ): Promise<ImportItemsResponseDto> {
    const profileId = await this.resolveProfileId(userId, dto.profile_id);
    const profile = await this.findOwnedProfileOrThrow(userId, profileId);
    const allowedLanguageIds = profileLanguageIds(
      profile.primaryLanguageId,
      profile.secondaryLanguageId,
    );

    const resolution = await this.resolveItems(dto.items, allowedLanguageIds);
    if (resolution.dedupedResolved.length === 0) {
      throw new DomainException(
        'IMPORT_NO_MATCHED_ITEMS',
        'Không tìm thấy từ nào hợp lệ trong từ điển để tạo bộ sưu tập',
        HttpStatus.UNPROCESSABLE_ENTITY,
        {
          total_submitted: dto.items.length,
          not_found_count: resolution.notFound.length,
          not_found: resolution.notFound,
        },
      );
    }

    const collectionId = uuidv7();
    const status = dto.status ?? 'learning';
    const added: ImportAddedItemDto[] = [];
    const insertedSenses: { senseId: bigint; languageId: number }[] = [];

    await this.prisma.$transaction(
      async (tx) => {
        await lockUser(tx, userId);

        const lockedProfile = await tx.studyProfile.findFirst({
          where: { id: profileId, userId },
          select: {
            id: true,
            primaryLanguageId: true,
            secondaryLanguageId: true,
          },
        });
        if (!lockedProfile) {
          throw new DomainException(
            'PROFILE_NOT_FOUND',
            'Không tìm thấy hồ sơ học',
            HttpStatus.CONFLICT,
          );
        }
        assertLanguagesInProfile(
          profileLanguageIds(
            lockedProfile.primaryLanguageId,
            lockedProfile.secondaryLanguageId,
          ),
          resolution.dedupedResolved.map((row) => row.sense.language_id),
        );

        const now = new Date();
        const prepared = resolution.dedupedResolved.map((row, idx) => {
          const itemId = uuidv7();
          const faceId = uuidv7();
          return {
            row,
            item: {
              id: itemId,
              collectionId,
              conceptId: row.sense.concept_id,
              anchorSenseId: row.sense.sense_id,
              meaningVi: row.sense.meaning_vi,
              meaningSource: row.sense.meaning_source,
              note: row.input.note,
              status,
              position: idx + 1,
            },
            face: {
              id: faceId,
              itemId,
              senseId: row.sense.sense_id,
              languageId: row.sense.language_id,
              role: 'primary',
            },
            srs: {
              faceId,
              userId,
              profileId,
              state: 'new',
              dueAt: now,
            },
          };
        });

        await tx.collection.create({
          data: {
            id: collectionId,
            profileId,
            ownerId: userId,
            name: dto.name.trim(),
            description: dto.description ?? null,
            kind: 'personal',
            itemCount: prepared.length,
          },
        });
        await tx.collectionItem.createMany({
          data: prepared.map((entry) => entry.item),
        });
        await tx.collectionItemFace.createMany({
          data: prepared.map((entry) => entry.face),
        });
        await tx.srsState.createMany({
          data: prepared.map((entry) => entry.srs),
        });

        for (const entry of prepared) {
          added.push(toAddedDto(entry.row, entry.item.id));
          insertedSenses.push({
            senseId: entry.row.sense.sense_id,
            languageId: entry.row.sense.language_id,
          });
        }
      },
      { timeout: IMPORT_TRANSACTION_TIMEOUT_MS },
    );

    await this.prewarmQuizBank(insertedSenses, collectionId);
    const collection = await this.collectionsService.get(userId, collectionId);

    return {
      collection,
      total_submitted: dto.items.length,
      added_count: added.length,
      skipped_duplicate_count: resolution.duplicateInRequest.length,
      not_found_count: resolution.notFound.length,
      added,
      skipped_duplicates: resolution.duplicateInRequest,
      not_found: resolution.notFound,
    };
  }

  private async resolveItems(
    rawItems: ImportItemsDto['items'],
    allowedLanguageIds: number[],
  ): Promise<{
    dedupedResolved: ResolvedRow[];
    duplicateInRequest: ImportSkippedDuplicateDto[];
    notFound: ImportNotFoundItemDto[];
  }> {
    const normalizedRows: NormalizedInputRow[] = rawItems.map((item, index) => {
      const extracted = extractInlineWordMetadata(item.word);
      const word = extracted.word;
      const lower = word.toLowerCase();
      const capitalized =
        /^[a-z]/.test(lower) && lower.length > 1
          ? lower[0].toUpperCase() + lower.slice(1)
          : lower;
      const kanaOnly = isKanaOnly(word);
      const kanaKey = kanaOnly ? normalizeKanaKey(word) : null;
      const katakanaKey = kanaOnly ? toKatakanaKey(word) : null;
      const lookupKeys = [
        ...new Set(
          [
            word,
            lower,
            capitalized,
            ...(kanaKey ? [kanaKey] : []),
            ...(katakanaKey ? [katakanaKey] : []),
          ].filter((k) => k.length > 0),
        ),
      ];
      const rawReading =
        item.reading ?? item.phonetic ?? extracted.inlineReading;
      const rawSourceType = item.source_type ?? item.type;
      const note =
        item.note !== undefined && item.note !== null && item.note.trim() !== ''
          ? item.note.trim()
          : null;
      return {
        index,
        rawWord: item.word,
        word,
        lookupKeys,
        kanaKey,
        rawPos: item.pos ?? extracted.inlinePos ?? null,
        normalizedPos:
          normalizeImportPos(item.pos) ?? extracted.inlinePos ?? null,
        readings: normalizeImportReadings(rawReading),
        note,
        supportedType: isSupportedImportSourceType(rawSourceType),
      };
    });

    const notFound: ImportNotFoundItemDto[] = [];
    const lookupRows: NormalizedInputRow[] = [];

    for (const row of normalizedRows) {
      if (!row.supportedType) {
        notFound.push({
          index: row.index,
          word: row.rawWord,
          pos: row.rawPos,
          reason: 'unsupported_type',
        });
      } else {
        lookupRows.push(row);
      }
    }

    if (lookupRows.length === 0) {
      return { dedupedResolved: [], duplicateInRequest: [], notFound };
    }

    const uniqueLookupWords = [
      ...new Set(lookupRows.flatMap((row) => row.lookupKeys)),
    ];
    const uniqueKanaReadings = [
      ...new Set(
        lookupRows.flatMap((row) =>
          row.kanaKey !== null
            ? [row.word, row.kanaKey, toKatakanaKey(row.kanaKey)]
            : [],
        ),
      ),
    ];

    const candidates = await this.lookupRepo.findLexemeCandidates(
      uniqueLookupWords,
      uniqueKanaReadings,
      allowedLanguageIds,
    );

    const byKey = new Map<string, ImportLexemeCandidate[]>();
    const addCandidateKey = (key: string, candidate: ImportLexemeCandidate) => {
      if (!key) return;
      const list = byKey.get(key);
      if (list) list.push(candidate);
      else byKey.set(key, [candidate]);
    };
    for (const candidate of candidates) {
      const key = candidate.matched_key;
      addCandidateKey(key, candidate);
      const lowerKey = key.toLowerCase();
      if (lowerKey !== key) addCandidateKey(lowerKey, candidate);
      if (isKanaOnly(key)) {
        const hira = normalizeKanaKey(key);
        if (hira !== key) addCandidateKey(hira, candidate);
      }
    }

    const winningByRow: {
      input: NormalizedInputRow;
      lexemeId: bigint;
      posMatched: boolean;
      deinflectedFrom: string | null;
    }[] = [];
    let missedRows: NormalizedInputRow[] = [];

    for (const row of lookupRows) {
      const rowCandidates = collectCandidatesForRow(row, byKey);
      if (rowCandidates.length === 0) {
        missedRows.push(row);
        continue;
      }
      const picked = pickBestLexemeCandidate(row, rowCandidates);
      winningByRow.push({
        input: row,
        lexemeId: picked.candidate.lexeme_id,
        posMatched: picked.posMatched,
        deinflectedFrom: null,
      });
    }

    // M4.9 Bước 2: Deinflection theo lô cho các dòng tiếng Nhật chưa khớp chính xác
    if (missedRows.length > 0 && allowedLanguageIds.includes(2)) {
      const deinflectPlan = missedRows.map((row) => ({
        row,
        candidates: deinflectJapaneseDetailed(row.word, 8),
        expandedReadings: expandDeinflectedReadings(row.readings),
      }));

      const allDeinflectWords = [
        ...new Set(
          deinflectPlan.flatMap((entry) =>
            entry.candidates.flatMap((c) => {
              const keys = [c.word];
              if (isKanaOnly(c.word)) {
                const hira = normalizeKanaKey(c.word);
                const kata = toKatakanaKey(hira);
                keys.push(hira, kata);
              }
              return keys;
            }),
          ),
        ),
      ];
      const allDeinflectKana = [
        ...new Set(
          deinflectPlan.flatMap((entry) =>
            entry.candidates.flatMap((c) =>
              isKanaOnly(c.word)
                ? [normalizeKanaKey(c.word), toKatakanaKey(c.word)]
                : [],
            ),
          ),
        ),
      ];

      if (allDeinflectWords.length > 0) {
        const deinflectRows = await this.lookupRepo.findLexemeCandidates(
          allDeinflectWords,
          allDeinflectKana,
          [2],
        );
        const deinflectByKey = indexCandidatesByKey(deinflectRows);
        const remainingMissed: NormalizedInputRow[] = [];

        for (const entry of deinflectPlan) {
          const picked = pickBestDeinflectedCandidate(
            entry.row,
            entry.candidates,
            entry.expandedReadings,
            deinflectByKey,
          );
          if (picked) {
            winningByRow.push({
              input: entry.row,
              lexemeId: picked.candidate.lexeme_id,
              posMatched: picked.posMatched,
              deinflectedFrom: entry.row.rawWord,
            });
          } else {
            remainingMissed.push(entry.row);
          }
        }
        missedRows = remainingMissed;
      }
    }

    // M4.9 Bước 3 (§4.4): Cứu trường hợp file bị cụt chữ cuối nhưng có reading kana duy nhất
    if (
      missedRows.length > 0 &&
      allowedLanguageIds.includes(2) &&
      typeof this.lookupRepo.findJapaneseByReadings === 'function'
    ) {
      const readingEligible = missedRows.filter(
        (row) =>
          row.word.length >= 2 &&
          row.readings.some((r) => isKanaOnly(r) && r.length >= 2),
      );
      if (readingEligible.length > 0) {
        const readingKeys = [
          ...new Set(
            readingEligible.flatMap((row) =>
              row.readings.flatMap((r) =>
                isKanaOnly(r) ? [r, toKatakanaKey(r)] : [],
              ),
            ),
          ),
        ];
        const byReadingRows =
          await this.lookupRepo.findJapaneseByReadings(readingKeys);
        const byReadingMap = new Map<string, ImportLexemeCandidate[]>();
        for (const cand of byReadingRows) {
          if (!cand.reading) continue;
          const rk = normalizeKanaKey(cand.reading);
          const list = byReadingMap.get(rk);
          if (list) list.push(cand);
          else byReadingMap.set(rk, [cand]);
        }

        const rescuedIndexes = new Set<number>();
        for (const row of readingEligible) {
          const matched: ImportLexemeCandidate[] = [];
          for (const r of row.readings) {
            const list = byReadingMap.get(r);
            if (!list) continue;
            for (const cand of list) {
              if (cand.lemma.startsWith(row.word) && cand.lemma !== row.word) {
                matched.push(cand);
              }
            }
          }
          const uniqueLemmas = new Set(matched.map((c) => c.lemma));
          if (uniqueLemmas.size === 1) {
            const picked = pickBestLexemeCandidate(row, matched);
            winningByRow.push({
              input: row,
              lexemeId: picked.candidate.lexeme_id,
              posMatched: picked.posMatched,
              deinflectedFrom: row.rawWord,
            });
            rescuedIndexes.add(row.index);
          }
        }
        if (rescuedIndexes.size > 0) {
          missedRows = missedRows.filter(
            (row) => !rescuedIndexes.has(row.index),
          );
        }
      }
    }

    winningByRow.sort((a, b) => a.input.index - b.input.index);

    if (missedRows.length > 0) {
      const otherLanguageIds = SUPPORTED_STUDY_LANGUAGE_IDS.filter(
        (id) => !allowedLanguageIds.includes(id),
      );
      let existingInOther = new Set<string>();
      if (otherLanguageIds.length > 0) {
        const missedWords = [
          ...new Set(missedRows.flatMap((row) => row.lookupKeys)),
        ];
        const missedKana = [
          ...new Set(
            missedRows.flatMap((row) =>
              row.kanaKey !== null ? [row.word, row.kanaKey] : [],
            ),
          ),
        ];
        existingInOther = await this.lookupRepo.findExistingWordsInLanguages(
          missedWords,
          missedKana,
          otherLanguageIds,
        );
      }

      for (const row of missedRows) {
        const inOtherLang =
          row.lookupKeys.some((key) => existingInOther.has(key)) ||
          (row.kanaKey !== null && existingInOther.has(row.kanaKey));
        notFound.push({
          index: row.index,
          word: row.rawWord,
          pos: row.rawPos,
          reason: inOtherLang ? 'language_not_in_profile' : 'not_in_dictionary',
        });
      }
    }

    const uniqueLexemeIds = [
      ...new Set(winningByRow.map((entry) => entry.lexemeId.toString())),
    ].map(BigInt);

    const topSenses =
      await this.lookupRepo.findTopSensesByLexemeIds(uniqueLexemeIds);
    const senseByLexemeId = new Map(
      topSenses.map((sense) => [sense.lexeme_id.toString(), sense]),
    );

    const dedupedResolved: ResolvedRow[] = [];
    const duplicateInRequest: ImportSkippedDuplicateDto[] = [];
    const seenSenseIds = new Set<string>();

    for (const entry of winningByRow) {
      const sense = senseByLexemeId.get(entry.lexemeId.toString());
      if (!sense) {
        notFound.push({
          index: entry.input.index,
          word: entry.input.rawWord,
          pos: entry.input.rawPos,
          reason: 'not_in_dictionary',
        });
        continue;
      }

      const senseKey = sense.sense_id.toString();
      if (seenSenseIds.has(senseKey)) {
        duplicateInRequest.push({
          index: entry.input.index,
          word: entry.input.rawWord,
          sense_id: senseKey,
          lemma: sense.lemma,
          reason: 'duplicate_in_request',
        });
        continue;
      }
      seenSenseIds.add(senseKey);
      dedupedResolved.push({
        input: entry.input,
        sense,
        posMatched: entry.posMatched,
        deinflectedFrom: entry.deinflectedFrom,
      });
    }

    notFound.sort((a, b) => a.index - b.index);
    return { dedupedResolved, duplicateInRequest, notFound };
  }

  private async prewarmQuizBank(
    senses: { senseId: bigint; languageId: number }[],
    collectionId: string,
  ): Promise<void> {
    if (!this.quizBankRepo || senses.length === 0) return;
    try {
      await this.quizBankRepo.enqueueBatchImportedSenses(senses);
    } catch (err) {
      this.logger.warn(
        `Pre-warm quiz bank skipped for import into collection ${collectionId}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }

  private async resolveProfileId(
    userId: bigint,
    profileId?: string,
  ): Promise<string> {
    if (profileId !== undefined) {
      await this.findOwnedProfileOrThrow(userId, profileId);
      return profileId;
    }

    const settings = await this.prisma.userSettings.findUnique({
      where: { userId },
    });
    if (settings?.activeProfileId) {
      return settings.activeProfileId;
    }

    const fallback = await this.prisma.studyProfile.findFirst({
      where: { userId, isDefault: true },
      select: { id: true },
    });
    if (fallback) {
      return fallback.id;
    }

    throw new DomainException(
      'PROFILE_REQUIRED',
      'Hãy tạo hồ sơ học trước khi tạo bộ sưu tập',
      HttpStatus.CONFLICT,
    );
  }

  private async findOwnedProfileOrThrow(userId: bigint, profileId: string) {
    const profile = await this.prisma.studyProfile.findFirst({
      where: { id: profileId, userId },
      select: {
        id: true,
        primaryLanguageId: true,
        secondaryLanguageId: true,
      },
    });
    if (!profile) {
      throw new DomainException(
        'PROFILE_NOT_FOUND',
        'Không tìm thấy hồ sơ học',
        HttpStatus.NOT_FOUND,
      );
    }
    return profile;
  }
}

function collectCandidatesForRow(
  row: NormalizedInputRow,
  byKey: Map<string, ImportLexemeCandidate[]>,
): ImportLexemeCandidate[] {
  const bestByLexeme = new Map<string, ImportLexemeCandidate>();
  const keys =
    row.kanaKey !== null ? [...row.lookupKeys, row.kanaKey] : row.lookupKeys;

  for (const key of keys) {
    const matches = byKey.get(key);
    if (!matches) continue;
    for (const candidate of matches) {
      const idKey = candidate.lexeme_id.toString();
      const prev = bestByLexeme.get(idKey);
      if (!prev || candidate.match_source < prev.match_source) {
        bestByLexeme.set(idKey, candidate);
      }
    }
  }

  return [...bestByLexeme.values()];
}

function pickBestLexemeCandidate(
  row: NormalizedInputRow,
  candidates: ImportLexemeCandidate[],
): { candidate: ImportLexemeCandidate; posMatched: boolean } {
  let pool = candidates;
  let posMatched = true;

  if (row.normalizedPos !== null) {
    const matchingPos = candidates.filter(
      (candidate) => candidate.pos === row.normalizedPos,
    );
    if (matchingPos.length > 0) {
      pool = matchingPos;
      posMatched = true;
    } else {
      posMatched = false;
    }
  }

  const sorted = [...pool].sort((a, b) => compareCandidates(a, b, row));
  return { candidate: sorted[0], posMatched };
}

function compareCandidates(
  a: ImportLexemeCandidate,
  b: ImportLexemeCandidate,
  row: NormalizedInputRow,
): number {
  const readingDiff = readingMatchRank(a, row) - readingMatchRank(b, row);
  if (readingDiff !== 0) return readingDiff;

  const sourceDiff = authoritativeSourceRank(a) - authoritativeSourceRank(b);
  if (sourceDiff !== 0) return sourceDiff;

  if (a.match_source !== b.match_source) {
    return a.match_source - b.match_source;
  }

  if (a.has_vi_gloss !== b.has_vi_gloss) {
    return a.has_vi_gloss ? -1 : 1;
  }

  const freqA = a.frequency_rank ?? Number.MAX_SAFE_INTEGER;
  const freqB = b.frequency_rank ?? Number.MAX_SAFE_INTEGER;
  if (freqA !== freqB) return freqA - freqB;

  const learnerA = a.en_learner_rank ?? Number.MAX_SAFE_INTEGER;
  const learnerB = b.en_learner_rank ?? Number.MAX_SAFE_INTEGER;
  if (learnerA !== learnerB) return learnerA - learnerB;

  return a.lexeme_id < b.lexeme_id ? -1 : a.lexeme_id > b.lexeme_id ? 1 : 0;
}

function readingMatchRank(
  candidate: ImportLexemeCandidate,
  row: NormalizedInputRow,
): number {
  if (row.readings.length === 0) return 0;
  if (!candidate.reading) return Number.MAX_SAFE_INTEGER;
  const candidateKana = normalizeKanaKey(candidate.reading);
  const idx = row.readings.indexOf(candidateKana);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

function authoritativeSourceRank(candidate: ImportLexemeCandidate): number {
  if (candidate.language_id === 2) {
    return candidate.is_jmdict ? 0 : 1;
  }
  if (candidate.language_id === 1) {
    return candidate.en_learner_rank !== null ? 0 : 1;
  }
  return 0;
}

function indexCandidatesByKey(
  candidates: ImportLexemeCandidate[],
): Map<string, ImportLexemeCandidate[]> {
  const byKey = new Map<string, ImportLexemeCandidate[]>();
  const add = (key: string, candidate: ImportLexemeCandidate) => {
    if (!key) return;
    const list = byKey.get(key);
    if (list) list.push(candidate);
    else byKey.set(key, [candidate]);
  };
  for (const candidate of candidates) {
    const key = candidate.matched_key;
    add(key, candidate);
    const lowerKey = key.toLowerCase();
    if (lowerKey !== key) add(lowerKey, candidate);
    if (isKanaOnly(key)) {
      const hira = normalizeKanaKey(key);
      if (hira !== key) add(hira, candidate);
    }
  }
  return byKey;
}

function expandDeinflectedReadings(readings: string[]): string[] {
  if (readings.length === 0) return [];
  const expanded: string[] = [];
  for (const r of readings) {
    expanded.push(r);
    if (isKanaOnly(r)) {
      for (const base of deinflectJapanese(r, 4)) {
        expanded.push(normalizeKanaKey(base));
      }
    }
  }
  return [...new Set(expanded)];
}

function pickBestDeinflectedCandidate(
  row: NormalizedInputRow,
  deinflectCandidates: DeinflectCandidate[],
  expandedReadings: string[],
  byKey: Map<string, ImportLexemeCandidate[]>,
): { candidate: ImportLexemeCandidate; posMatched: boolean } | null {
  const rowWithExpandedReadings: NormalizedInputRow = {
    ...row,
    readings: expandedReadings,
  };

  for (const dc of deinflectCandidates) {
    const keys = isKanaOnly(dc.word)
      ? [dc.word, normalizeKanaKey(dc.word), toKatakanaKey(dc.word)]
      : [dc.word];
    const bestByLexeme = new Map<string, ImportLexemeCandidate>();
    for (const k of keys) {
      const list = byKey.get(k);
      if (!list) continue;
      for (const cand of list) {
        const idKey = cand.lexeme_id.toString();
        const prev = bestByLexeme.get(idKey);
        if (!prev || cand.match_source < prev.match_source) {
          bestByLexeme.set(idKey, cand);
        }
      }
    }
    const matches = [...bestByLexeme.values()];
    if (matches.length === 0) continue;

    // Ưu tiên ứng viên khớp POS người dùng (nếu có), sau đó ưu tiên mềm theo expectedPos của quy tắc chia thể
    let pool = matches;
    let posMatched = true;
    if (row.normalizedPos !== null) {
      const userPosMatches = matches.filter((c) => c.pos === row.normalizedPos);
      if (userPosMatches.length > 0) {
        pool = userPosMatches;
        posMatched = true;
      } else {
        posMatched = false;
      }
    } else if (dc.expectedPos.length > 0) {
      const expectedMatches = matches.filter(
        (c) =>
          c.pos !== null &&
          (dc.expectedPos as readonly string[]).includes(c.pos),
      );
      if (expectedMatches.length > 0) {
        pool = expectedMatches;
      }
    }

    const sorted = [...pool].sort((a, b) => {
      const exactScriptA = a.matched_key === dc.word ? 0 : 1;
      const exactScriptB = b.matched_key === dc.word ? 0 : 1;
      if (exactScriptA !== exactScriptB) return exactScriptA - exactScriptB;
      return compareCandidates(a, b, rowWithExpandedReadings);
    });
    return { candidate: sorted[0], posMatched };
  }

  return null;
}

function toAddedDto(row: ResolvedRow, itemId: string): ImportAddedItemDto {
  return {
    index: row.input.index,
    word: row.input.rawWord,
    item_id: itemId,
    sense_id: row.sense.sense_id.toString(),
    lemma: row.sense.lemma,
    reading: row.sense.reading,
    pos: row.sense.pos,
    meaning_vi: row.sense.meaning_vi,
    pos_matched: row.posMatched,
    deinflected_from: row.deinflectedFrom,
  };
}
