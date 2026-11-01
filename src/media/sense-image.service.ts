import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../db/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { SenseImageRepository } from './sense-image.repository';
import {
  ImageContract,
  ImageCandidate,
  SenseImageSource,
} from './types/image.types';
import { classifyImageSource, selectRootSense } from './image-policy';
import { mapImage } from './image-mapper';

@Injectable()
export class SenseImageService {
  private readonly baseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: SenseImageRepository,
    config: ConfigService,
  ) {
    this.baseUrl =
      config.get<string>('MEDIA_BASE_URL') || 'https://media.langoo.org';
  }

  async resolveMany(ids: bigint[]): Promise<Map<string, ImageContract | null>> {
    const result = new Map<string, ImageContract | null>();
    if (ids.length === 0) {
      return result;
    }

    const uniqueIds = Array.from(new Set(ids));

    return this.prisma.$transaction(
      async (tx) => {
        // Query 1: Direct candidates and source metadata
        const sources = await this.repo.findSourcesWithDirectImages(
          tx,
          uniqueIds,
        );
        const sourceMap = new Map<string, SenseImageSource>();
        for (const s of sources) {
          sourceMap.set(s.sense_id.toString(), s);
        }

        const directCandidateMap = new Map<string, ImageCandidate | null>();
        const needFallbackSources: {
          sense_id: bigint;
          rootLemma: string;
          rootPos: string;
          language_id: number;
        }[] = [];

        for (const id of uniqueIds) {
          const strId = id.toString();
          const source = sourceMap.get(strId);
          if (!source) {
            directCandidateMap.set(strId, null);
            continue;
          }

          const classification = classifyImageSource(source);
          if (classification.kind === 'no_image') {
            directCandidateMap.set(strId, null);
          } else if (classification.kind === 'direct') {
            directCandidateMap.set(strId, source.directCandidate);
          } else if (classification.kind === 'inflection') {
            if (source.directCandidate) {
              directCandidateMap.set(strId, source.directCandidate);
            } else if (classification.rootLemma && classification.rootPos) {
              needFallbackSources.push({
                sense_id: source.sense_id,
                rootLemma: classification.rootLemma,
                rootPos: classification.rootPos,
                language_id: source.language_id,
              });
            } else {
              directCandidateMap.set(strId, null);
            }
          }
        }

        // If there are inflection sources needing root fallback:
        if (needFallbackSources.length > 0) {
          // Query 2: Root candidates and relations
          const { relations, lexicalRoots } =
            await this.repo.findRootCandidates(tx, needFallbackSources);

          const sourceToTargetRoot = new Map<string, bigint>();
          const targetRootIds: bigint[] = [];

          for (const s of needFallbackSources) {
            const matchingLexical = lexicalRoots.filter(
              (r) =>
                r.language_id === s.language_id &&
                r.lemma.toLowerCase() === s.rootLemma.toLowerCase() &&
                r.pos === s.rootPos &&
                classifyImageSource({
                  sense_id: r.sense_id,
                  lemma: r.lemma,
                  pos: r.pos,
                  language_id: r.language_id,
                  definition: r.definition,
                  directCandidate: null,
                }).kind === 'direct',
            );

            const sourceObj = sourceMap.get(s.sense_id.toString())!;
            const targetSenseId = selectRootSense(
              sourceObj,
              relations,
              matchingLexical,
            );
            if (targetSenseId !== null && targetSenseId !== s.sense_id) {
              sourceToTargetRoot.set(s.sense_id.toString(), targetSenseId);
              targetRootIds.push(targetSenseId);
            }
          }

          // Query 3: Direct images of target root senses
          if (targetRootIds.length > 0) {
            const rootImagesMap = await this.repo.findDirectImages(
              tx,
              targetRootIds,
            );
            for (const [
              sourceIdStr,
              targetId,
            ] of sourceToTargetRoot.entries()) {
              const rootCandidate =
                rootImagesMap.get(targetId.toString()) ?? null;
              directCandidateMap.set(sourceIdStr, rootCandidate);
            }
          }
        }

        // Final mapping
        for (const id of uniqueIds) {
          const strId = id.toString();
          const candidate = directCandidateMap.get(strId) ?? null;
          result.set(strId, mapImage(candidate, this.baseUrl));
        }

        return result;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      },
    );
  }
}
