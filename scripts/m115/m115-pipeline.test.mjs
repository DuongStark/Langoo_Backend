import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  derivePosBucket,
  longVowelKey,
  validateBankCandidate,
  toQuestionSegments,
} from './core-gate.mjs';
import { runDualPoolGenerator } from './generate-agy-batch.mjs';
import {
  reconcileMuseVerdicts,
  buildBlindValidationPack,
  runMuseValidator,
} from './validate-muse-batch.mjs';
import {
  buildValidatorPrompt,
  runHydrogenValidator,
} from './validate-hydrogen-batch.mjs';
import { buildUpsertSql } from './apply-bank.mjs';
import { applyRepair } from './repair-rejected-bank.mjs';

test('repairs preserve the rejected sense and skill and rerun the cloze code gate', () => {
  const original = {
    candidateId: 'rejected-student',
    senseId: '100',
    languageCode: 'en',
    skill: 'context_cloze',
    lemma: 'student',
    pos: 'noun',
    targetSurface: 'student',
    canonicalAnswer: 'student',
    sentenceBefore: 'As a ',
    sentenceAfter: ' at nursing school, she attended a lecture.',
    rubricVersion: 'm11.5-v1',
    variantNo: 2,
  };
  const source = { attributes: {} };
  assert.equal(applyRepair(original, source, {
    ok: true, before: 'As a', after: 'at the nursing school, she attended a lecture.',
  }).reason, 'en_article_leak');
  assert.equal(applyRepair(original, source, {
    ok: true, before: 'The 【teacher】 ', after: ' earned credit at the clinical placement.',
  }).reason, 'stray_brackets');
  const { row } = applyRepair(original, source, {
    ok: true,
    before: 'Every ',
    after: ' in the nursing program must complete a clinical placement to earn course credit.',
    excludedWords: ['trainee'],
  });
  assert.equal(row.senseId, original.senseId);
  assert.equal(row.skill, original.skill);
  assert.equal(row.variantNo, original.variantNo);
  assert.equal(row.canonicalAnswer, original.canonicalAnswer);
  assert.equal(row.generatorModel, 'muse-ai');
  assert.equal(row.repairOriginalCandidateId, original.candidateId);
  assert.deepEqual(row.excludedWords, ['trainee']);
});

test('derivePosBucket splits Japanese i-adj vs na-adj and prefixes language', () => {
  assert.equal(derivePosBucket('en', 'noun', {}, 'ticket'), 'en:noun');
  assert.equal(derivePosBucket('en', 'verb', {}, 'run'), 'en:verb');
  assert.equal(
    derivePosBucket('ja', 'adjective', { pos_tags: ['adj-i'] }, '高い'),
    'ja:adj-i',
  );
  assert.equal(
    derivePosBucket('ja', 'adjective', { pos_tags: ['adj-na'] }, '静か'),
    'ja:adj-na',
  );
  assert.equal(derivePosBucket('ja', 'adjective', {}, '忙しい'), 'ja:adj-i');
  assert.equal(derivePosBucket('ja', 'adjective', {}, '便利'), 'ja:adj-na');
});

test('validateBankCandidate enforces lemma, article guard, and segments for context_cloze', () => {
  const badArticle = validateBankCandidate({
    senseId: '101',
    languageCode: 'en',
    skill: 'context_cloze',
    lemma: 'apple',
    pos: 'noun',
    sentence: 'She ate an 【apple】 after lunch.',
    excludedWords: ['pear', 'Apple', ''],
  });
  assert.equal(badArticle.ok, false);
  assert.equal(badArticle.reason, 'en_article_leak');

  const leaked = validateBankCandidate({
    senseId: '101',
    languageCode: 'en',
    skill: 'context_cloze',
    lemma: 'ticket',
    pos: 'noun',
    sentence: 'Buy your 【ticket】 at the ticket counter.',
    excludedWords: ['pass'],
  });
  assert.equal(leaked.ok, false);
  assert.equal(leaked.reason, 'target_leaked');

  // Short English lemma ('eat') must NOT false-trigger target_leaked on 'weather'
  const shortEnOk = validateBankCandidate({
    senseId: '109',
    languageCode: 'en',
    skill: 'context_cloze',
    lemma: 'eat',
    pos: 'verb',
    sentence: 'Because the weather was nice, we decided to 【eat】 outside.',
    excludedWords: ['dine'],
  });
  assert.equal(shortEnOk.ok, true);

  const good = validateBankCandidate({
    senseId: '101',
    languageCode: 'en',
    skill: 'context_cloze',
    lemma: 'ticket',
    pos: 'noun',
    sentence: 'Please show your 【ticket】 at the gate.',
    excludedWords: ['Pass', 'fare', 'TICKET'],
  });
  assert.equal(good.ok, true);
  assert.equal(good.sentenceBefore, 'Please show your ');
  assert.equal(good.targetSurface, 'ticket');
  assert.equal(good.sentenceAfter, ' at the gate.');
  assert.deepEqual(good.excludedWords, ['pass', 'fare']);
  assert.deepEqual(toQuestionSegments(good), {
    before: 'Please show your ',
    highlight: null,
    after: ' at the gate.',
  });
});

test('validateBankCandidate filters long-vowel phonetic duplicates and kanji orthography leaks', () => {
  assert.equal(longVowelKey('せんせい'), longVowelKey('せんせえ'));
  assert.equal(longVowelKey('がっこう'), longVowelKey('がっこー'));

  const dupReading = validateBankCandidate({
    senseId: '202',
    languageCode: 'ja',
    skill: 'kanji_reading',
    lemma: '先生',
    pos: 'noun',
    written: '先生',
    reading: 'せんせい',
    knownReadings: ['せんせい'],
    sentence: '新しい【先生】に挨拶しました。',
    distractors: ['せんせえ', 'せんさい', 'しんせい'],
  });
  assert.equal(dupReading.ok, false);
  assert.equal(dupReading.reason, 'invalid_reading_distractors');

  const goodReading = validateBankCandidate({
    senseId: '202',
    languageCode: 'ja',
    skill: 'kanji_reading',
    lemma: '宿題',
    pos: 'noun',
    written: '宿題',
    reading: 'しゅくだい',
    knownReadings: ['しゅくだい'],
    sentence: '寝る前に今日の【宿題】を全部終わらせました。',
    distractors: ['しゅうだい', 'しゅくたい', 'じゅくだい'],
  });
  assert.equal(goodReading.ok, true);
  assert.deepEqual(toQuestionSegments(goodReading), {
    before: '寝る前に今日の',
    highlight: '宿題',
    after: 'を全部終わらせました。',
  });

  const goodOrtho = validateBankCandidate({
    senseId: '202',
    languageCode: 'ja',
    skill: 'kanji_orthography',
    lemma: '食堂',
    pos: 'noun',
    written: '食堂',
    reading: 'しょくどう',
    knownWritings: ['食堂'],
    sentence: '昼休みに会社の【食堂】でカレーを食べました。',
    distractors: ['食掌', '食常', '食賞'],
  });
  assert.equal(goodOrtho.ok, true);
  assert.equal(goodOrtho.targetSurface, 'しょくどう');
  assert.equal(goodOrtho.canonicalAnswer, '食堂');
  assert.deepEqual(toQuestionSegments(goodOrtho), {
    before: '昼休みに会社の',
    highlight: 'しょくどう',
    after: 'でカレーを食べました。',
  });
});

test('runDualPoolGenerator continues with remaining pool when one pool hits 5h quota', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'm115-test-'));
  try {
    const senses = [1, 2, 3].map((n) => ({
      senseId: String(n),
      languageId: 1,
      languageCode: 'en',
      lemma: `word${n}`,
      pos: 'noun',
      attributes: {},
      glosses: [`meaning ${n}`],
      kanjiPairs: [],
    }));
    const calls = [];
    const invokeModel = async (model, batch) => {
      calls.push({ model, batchIndex: batch.batchIndex });
      if (model === 'claude-sonnet-4-6') {
        const err = new Error('RESOURCE_EXHAUSTED: 5h quota reached');
        err.code = 'QUOTA';
        throw err;
      }
      return {
        status: 'SUCCESS',
        response: JSON.stringify({
          items: batch.items.map((item) => ({
            senseId: item.senseId,
            context_cloze: [
              {
                sentence: `Please check the 【${item.lemma}】 carefully today.`,
                excludedWords: ['item'],
              },
            ],
            context_meaning: [
              {
                sentence: `They discussed the 【${item.lemma}】 during the meeting.`,
              },
            ],
          })),
        }),
      };
    };

    const summary = await runDualPoolGenerator({
      outDir: dir,
      senses,
      batchSize: 1,
      pools: [
        { model: 'claude-sonnet-4-6', concurrency: 1 },
        { model: 'gemini-4-hydrogen-medium', concurrency: 1 },
      ],
      invokeModel,
    });
    assert.equal(summary.completedBatches, 3);
    assert.equal(summary.gatedCount, 6);
    const lines = (await readFile(join(dir, 'gated_candidates.jsonl'), 'utf8'))
      .trim()
      .split('\n');
    assert.equal(lines.length, 6);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('reconcileMuseVerdicts blind-checks index, rejects ambiguous alt, and buildUpsertSql protects quarantined/human_reviewed', () => {
  const cands = [
    {
      candidateId: 'c1',
      senseId: '202',
      languageId: 2,
      skill: 'kanji_reading',
      variantNo: 1,
      sentenceBefore: '今日の',
      targetSurface: '宿題',
      sentenceAfter: 'です。',
      sentenceHash: 'a'.repeat(64),
      canonicalAnswer: 'しゅくだい',
      fixedDistractors: ['しゅうだい', 'しゅくたい', 'じゅくだい'],
      posBucket: 'ja:noun',
      excludedWords: [],
      generatorModel: 'gemini-4-hydrogen-medium',
    },
    {
      candidateId: 'c2',
      senseId: '101',
      languageId: 1,
      skill: 'context_cloze',
      variantNo: 1,
      sentenceBefore: 'Please show your ',
      targetSurface: 'ticket',
      sentenceAfter: ' at the gate.',
      sentenceHash: 'b'.repeat(64),
      canonicalAnswer: 'ticket',
      fixedDistractors: [],
      posBucket: 'en:noun',
      excludedWords: ['pass'],
      generatorModel: 'claude-sonnet-4-6',
    },
  ];
  const pack = buildBlindValidationPack(cands, () => 2);
  // Correct answer for c1 was placed at index 2; simulate Muse picking 2 cleanly for c1, and flagging alt=[1] on another
  const accepted = reconcileMuseVerdicts(pack, [
    { id: 'c1', pick: 2, alt: [], ok: true },
    { id: 'c2', ok: true, alt: [], extraExcluded: ['Voucher', 'ticket'] },
  ]);
  assert.equal(accepted.length, 2);
  assert.deepEqual(accepted[1].excludedWords, ['pass', 'voucher']);

  const rejected = reconcileMuseVerdicts(pack, [
    { id: 'c1', pick: 1, alt: [], ok: true },
    { id: 'c2', ok: true, alt: [0] },
  ]);
  assert.equal(rejected.length, 0);

  const sql = buildUpsertSql();
  assert.match(sql, /ON CONFLICT\s*\(sense_id,\s*skill,\s*rubric_version,\s*variant_no\)/i);
  assert.match(sql, /lexeme_form_applies_to/i);
  assert.match(sql, /verification\s*<>\s*'human_reviewed'/i);
  assert.match(sql, /status\s*<>\s*'quarantined'/i);
});

test('Muse resumes a mixed checkpoint and hands distinct batches to eight concurrent workers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'm115-muse-val-'));
  try {
    const rows = Array.from({ length: 9 }, (_, index) => ({
      candidateId: `muse-${index}`,
      skill: 'context_cloze',
      canonicalAnswer: 'ticket',
      sentenceBefore: 'Please keep your ',
      sentenceAfter: ' until you leave the station.',
    }));
    const checkpointDir = join(dir, 'hydrogen_out');
    await mkdir(checkpointDir);
    await writeFile(join(checkpointDir, '00004.json'), JSON.stringify({
      batchNo: 4, candidateIds: ['muse-0'], approved: [rows[0]],
    }));
    await writeFile(join(dir, 'generation_done.json'), '{"complete":true}');
    await writeFile(join(dir, 'gated_candidates.jsonl'), rows.map(r => JSON.stringify(r)).join('\n'));

    const seen = new Set();
    const workers = new Set();
    let release;
    const barrier = new Promise((resolve) => { release = resolve; });
    const summary = await runMuseValidator({
      outDir: dir, batchSize: 1, concurrency: 8, native: true, follow: true,
      invokeMuse: async (_prompt, workerId, ids) => {
        assert.equal(ids.length, 1);
        assert.notEqual(ids[0], 'muse-0');
        assert.equal(seen.has(ids[0]), false);
        seen.add(ids[0]);
        workers.add(workerId);
        if (workers.size === 8) release();
        await barrier;
        return [{ id: ids[0], ok: true, alt: [] }];
      },
    });
    assert.equal(seen.size, 8);
    assert.equal(summary.processedCandidates, 9);
    assert.equal(summary.approvedTotal, 9);
    assert.equal(summary.batchesCompleted, 9);
    const saved = JSON.parse(await readFile(join(checkpointDir, '00005.json'), 'utf8'));
    assert.equal(saved.transport, 'native');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runHydrogenValidator validates concurrently across workers without duplicate claims and uses 4-option MC cloze rubric', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'm115-hyd-val-'));
  try {
    const gatedRows = [1, 2, 3, 4].map((n) => ({
      candidateId: `cand-${n}`,
      senseId: String(100 + n),
      languageId: 2,
      languageCode: 'ja',
      lemma: `テスト${n}`,
      pos: 'noun',
      meaning: `bài kiểm tra ${n}`,
      skill: 'context_cloze',
      variantNo: 1,
      rubricVersion: 'm11.5-v1',
      sentenceBefore: '来週大事な',
      targetSurface: `テスト${n}`,
      sentenceAfter: 'があります。',
      sentenceHash: String(n).repeat(64).slice(0, 64),
      canonicalAnswer: `テスト${n}`,
      fixedDistractors: [],
      posBucket: 'ja:noun',
      excludedWords: ['試験'],
      generatorModel: 'claude-sonnet-4-6',
    }));
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      join(dir, 'gated_candidates.jsonl'),
      gatedRows.map((r) => JSON.stringify(r)).join('\n') + '\n',
    );
    await writeFile(join(dir, 'generation_done.json'), '{"complete":true}\n');

    const promptSample = buildValidatorPrompt([
      {
        id: 'cand-1',
        skill: 'context_cloze',
        lang: 'ja',
        lemma: 'テスト1',
        posBucket: 'ja:noun',
        targetMeaning: 'bài kiểm tra 1',
        sentence: '来週大事な【___】があります。',
        filledWord: 'テスト1',
      },
    ]);
    assert.match(promptSample, /4-option multiple-choice/i);
    assert.doesNotMatch(promptSample, /pinpoint filledWord/i);

    const seenIds = [];
    const summary = await runHydrogenValidator({
      outDir: dir,
      follow: false,
      batchSize: 2,
      concurrency: 3,
      invokeValidator: async (_model, packItems) => {
        for (const p of packItems) seenIds.push(p.id);
        return {
          status: 'SUCCESS',
          response: JSON.stringify({
            results: packItems.map((p) => ({
              id: p.id,
              alt: [],
              ok: true,
              extraExcluded: ['考査'],
            })),
          }),
        };
      },
    });

    assert.equal(seenIds.length, 4);
    assert.equal(new Set(seenIds).size, 4);
    assert.equal(summary.approvedTotal, 4);
    const approvedLines = (await readFile(join(dir, 'approved_bank.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.equal(approvedLines.length, 4);
    assert.equal(approvedLines[0].validatorModel, 'gemini-4-hydrogen-medium');
    assert.deepEqual(approvedLines[0].excludedWords, ['試験', '考査']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cross-family mode: Hydrogen-generated items are blind-checked ONLY by Claude, and Claude-generated items ONLY by Hydrogen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'm115-cross-val-'));
  try {
    const gatedRows = [
      {
        candidateId: 'from-claude-1',
        senseId: '101',
        languageId: 1,
        languageCode: 'en',
        lemma: 'ticket',
        pos: 'noun',
        meaning: 'vé',
        skill: 'context_meaning',
        variantNo: 1,
        rubricVersion: 'm11.5-v1',
        sentenceBefore: 'Show your ',
        targetSurface: 'ticket',
        sentenceAfter: ' here.',
        sentenceHash: '1'.repeat(64),
        canonicalAnswer: 'ticket',
        fixedDistractors: [],
        posBucket: 'en:noun',
        excludedWords: [],
        generatorModel: 'claude-sonnet-4-6',
      },
      {
        candidateId: 'from-hydrogen-1',
        senseId: '102',
        languageId: 1,
        languageCode: 'en',
        lemma: 'wallet',
        pos: 'noun',
        meaning: 'ví',
        skill: 'context_meaning',
        variantNo: 1,
        rubricVersion: 'm11.5-v1',
        sentenceBefore: 'Keep your ',
        targetSurface: 'wallet',
        sentenceAfter: ' safe.',
        sentenceHash: '2'.repeat(64),
        canonicalAnswer: 'wallet',
        fixedDistractors: [],
        posBucket: 'en:noun',
        excludedWords: [],
        generatorModel: 'gemini-4-hydrogen-medium',
      },
    ];
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      join(dir, 'gated_candidates.jsonl'),
      gatedRows.map((r) => JSON.stringify(r)).join('\n') + '\n',
    );
    await writeFile(join(dir, 'generation_done.json'), '{"complete":true}\n');

    const routed = [];
    const summary = await runHydrogenValidator({
      outDir: dir,
      follow: false,
      batchSize: 10,
      validatorPools: [
        { model: 'gemini-4-hydrogen-medium', concurrency: 1 },
        { model: 'claude-sonnet-4-6', concurrency: 1 },
      ],
      invokeValidator: async (validatorModel, packItems) => {
        for (const p of packItems) {
          routed.push({ id: p.id, validatorModel });
        }
        return {
          status: 'SUCCESS',
          response: JSON.stringify({
            results: packItems.map((p) => ({ id: p.id, alt: [], ok: true })),
          }),
        };
      },
    });

    assert.equal(summary.approvedTotal, 2);
    assert.deepEqual(
      routed.sort((a, b) => a.id.localeCompare(b.id)),
      [
        { id: 'from-claude-1', validatorModel: 'gemini-4-hydrogen-medium' },
        { id: 'from-hydrogen-1', validatorModel: 'claude-sonnet-4-6' },
      ],
    );
    const approvedLines = (await readFile(join(dir, 'approved_bank.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.equal(approvedLines.length, 2);
    for (const row of approvedLines) {
      assert.notEqual(row.generatorModel, row.validatorModel);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
