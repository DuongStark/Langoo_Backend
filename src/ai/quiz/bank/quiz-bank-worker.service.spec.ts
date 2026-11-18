import { ConfigService } from '@nestjs/config';
import { validateEnv } from '../../../config/env.schema';
import {
  PublicSenseForBank,
  QuizBankGenerationJobRow,
  QuizBankRepository,
} from './quiz-bank.repository';
import {
  QUIZ_BANK_GENERATOR_CLIENT,
  QUIZ_BANK_VALIDATOR_CLIENT,
  QuizBankWorkerService,
} from './quiz-bank-worker.service';

const BASE_ENV = {
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/langoo_test',
  DIRECT_URL: 'postgresql://u:p@127.0.0.1:5432/langoo_test',
  JWT_ACCESS_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef',
};

describe('M11.5 QuizBankWorkerService & ENV contract', () => {
  describe('env.schema QUIZ_BANK_WORKER_* validation', () => {
    it('defaults QUIZ_BANK_WORKER_ENABLED to false without requiring worker keys', () => {
      const parsed = validateEnv({ ...BASE_ENV });
      expect(parsed.QUIZ_BANK_WORKER_ENABLED).toBe(false);
    });

    it('rejects QUIZ_BANK_WORKER_ENABLED=true when generator or validator credentials are missing', () => {
      expect(() =>
        validateEnv({
          ...BASE_ENV,
          QUIZ_BANK_WORKER_ENABLED: 'true',
          QUIZ_BANK_GENERATOR_BASE_URL: 'https://api.deepseek.com/v1',
          QUIZ_BANK_GENERATOR_MODEL: 'deepseek-chat',
        }),
      ).toThrow(/QUIZ_BANK_/);
    });

    it('rejects QUIZ_BANK_WORKER_ENABLED=true when generator and validator models are identical', () => {
      expect(() =>
        validateEnv({
          ...BASE_ENV,
          QUIZ_BANK_WORKER_ENABLED: 'true',
          QUIZ_BANK_GENERATOR_BASE_URL: 'https://api.deepseek.com/v1',
          QUIZ_BANK_GENERATOR_API_KEY: 'gen-secret-placeholder',
          QUIZ_BANK_GENERATOR_MODEL: 'deepseek-chat',
          QUIZ_BANK_VALIDATOR_BASE_URL: 'https://open.bigmodel.cn/api/paas/v4',
          QUIZ_BANK_VALIDATOR_API_KEY: 'val-secret-placeholder',
          QUIZ_BANK_VALIDATOR_MODEL: 'deepseek-chat',
        }),
      ).toThrow(/QUIZ_BANK_VALIDATOR_MODEL/);
    });

    it('accepts distinct DeepSeek generator + GLM validator models when enabled', () => {
      const parsed = validateEnv({
        ...BASE_ENV,
        QUIZ_BANK_WORKER_ENABLED: 'true',
        QUIZ_BANK_GENERATOR_BASE_URL: 'https://api.deepseek.com/v1',
        QUIZ_BANK_GENERATOR_API_KEY: 'gen-secret-placeholder',
        QUIZ_BANK_GENERATOR_MODEL: 'deepseek-chat',
        QUIZ_BANK_VALIDATOR_BASE_URL: 'https://open.bigmodel.cn/api/paas/v4',
        QUIZ_BANK_VALIDATOR_API_KEY: 'val-secret-placeholder',
        QUIZ_BANK_VALIDATOR_MODEL: 'glm-4.5',
      });
      expect(parsed.QUIZ_BANK_WORKER_ENABLED).toBe(true);
      expect(parsed.QUIZ_BANK_GENERATOR_MODEL).toBe('deepseek-chat');
      expect(parsed.QUIZ_BANK_VALIDATOR_MODEL).toBe('glm-4.5');
    });
  });

  describe('QuizBankWorkerService.processNextJob', () => {
    function makeSetup() {
      const repo: Record<string, jest.Mock> = {
        claimNextGenerationJob: jest.fn(),
        loadPublicSenseForBank: jest.fn(),
        saveGeneratedBankVariants: jest.fn().mockResolvedValue(2),
        markGenerationJobDone: jest.fn().mockResolvedValue(undefined),
        markGenerationJobIneligible: jest.fn().mockResolvedValue(undefined),
        rescheduleOrFailGenerationJob: jest.fn().mockResolvedValue(undefined),
      };
      const generatorClient: {
        chat: jest.Mock;
        chatStream: jest.Mock;
        name: string;
      } = {
        name: 'deepseek-gen',
        chat: jest.fn(),
        chatStream: jest.fn(),
      };
      const validatorClient: {
        chat: jest.Mock;
        chatStream: jest.Mock;
        name: string;
      } = {
        name: 'glm-val',
        chat: jest.fn(),
        chatStream: jest.fn(),
      };
      const configValues: Record<string, unknown> = {
        SCHEDULER_ENABLED: false,
        QUIZ_BANK_WORKER_ENABLED: true,
        QUIZ_BANK_GENERATOR_MODEL: 'deepseek-chat',
        QUIZ_BANK_VALIDATOR_MODEL: 'glm-4.5',
      };
      const config = {
        get: jest.fn((key: string) => configValues[key]),
      } as unknown as ConfigService;

      const worker = new QuizBankWorkerService(
        config,
        repo as unknown as QuizBankRepository,
        generatorClient,
        validatorClient,
        () => 2, // deterministic expectedIndex = 2 for 4-option blind check
      );

      return {
        worker,
        repo,
        generatorClient,
        validatorClient,
        tokens: { QUIZ_BANK_GENERATOR_CLIENT, QUIZ_BANK_VALIDATOR_CLIENT },
      };
    }

    it('returns false when no queued job is available', async () => {
      const { worker, repo, generatorClient } = makeSetup();
      repo.claimNextGenerationJob.mockResolvedValue(null);

      await expect(worker.processNextJob()).resolves.toBe(false);
      expect(generatorClient.chat).not.toHaveBeenCalled();
    });

    it('generates with DeepSeek from public sense data only, filters via Code Gate + GLM blind check, and saves active variants', async () => {
      const { worker, repo, generatorClient, validatorClient } = makeSetup();
      const job: QuizBankGenerationJobRow = {
        senseId: 501n,
        languageId: 2,
        priority: 10,
        attempts: 1,
        replenishCycles: 0,
      };
      const publicSense: PublicSenseForBank = {
        senseId: 501n,
        languageId: 2,
        languageCode: 'ja',
        lemma: '宿題',
        pos: 'noun',
        lexemeAttributes: { pos_tags: ['n'] },
        glossVi: 'bài tập về nhà',
        glossEn: ['homework', 'assignment'],
        kanjiPairs: [
          { written: '宿題', reading: 'しゅくだい', eligible: true },
        ],
      };
      repo.claimNextGenerationJob.mockResolvedValue(job);
      repo.loadPublicSenseForBank.mockResolvedValue(publicSense);

      generatorClient.chat.mockResolvedValue({
        content: JSON.stringify({
          items: [
            {
              senseId: '501',
              context_cloze: [
                // Valid variant
                {
                  sentence: '寝る前に今日の【宿題】を全部終わらせました。',
                  excludedWords: ['課題', '仕事'],
                },
                // Invalid variant: leaks lemma outside brackets -> must be dropped by Code Gate BEFORE GLM!
                {
                  sentence: '宿題が多くて今日の【宿題】が終わりません。',
                  excludedWords: ['課題'],
                },
              ],
              context_meaning: [
                {
                  sentence: '先生に数学の【宿題】を提出しました。',
                },
              ],
              kanji_reading: [
                // Valid reading item (will pass GLM with pick=2, alt=[])
                {
                  sentence: '週末の【宿題】はレポートを書くことです。',
                  distractors: ['しょくだい', 'しゅくたい', 'じゅくだい'],
                },
                // Ambiguous/wrong item (GLM picks wrong index -> must be rejected!)
                {
                  sentence: '夏休みの【宿題】を忘れないでください。',
                  distractors: ['しょくだい', 'しゅくたい', 'じゅくだい'],
                },
              ],
              kanji_orthography: [],
            },
          ],
        }),
        model: 'deepseek-chat',
        tokensIn: 120,
        tokensOut: 200,
        costUsd: 0,
      });

      validatorClient.chat.mockImplementation(
        (req: { messages: { content: string }[] }) => {
          const promptText = req.messages.map((m) => m.content).join('\n');
          // Leaked-lemma sentence must NEVER reach validator
          expect(promptText).not.toContain('宿題が多くて今日の');
          const inputJson = promptText.slice(
            promptText.indexOf('INPUT:\n') + 'INPUT:\n'.length,
          );
          const packItems = JSON.parse(inputJson) as {
            id: string;
            skill: string;
            sentence: string;
            options?: string[];
          }[];
          const results = packItems.map((p) => {
            if (p.sentence.includes('夏休みの')) {
              // Simulate GLM failing blind check (wrong pick)
              return { id: p.id, pick: 0, alt: [], ok: true };
            }
            if (p.options) {
              // Confirm correct answer was placed at deterministic index 2 without telling GLM
              expect(p.options[2]).toBe('しゅくだい');
              return { id: p.id, pick: 2, alt: [], ok: true };
            }
            return {
              id: p.id,
              alt: [],
              ok: true,
              extraExcluded: ['レポート'],
            };
          });
          return Promise.resolve({
            content: JSON.stringify({ results }),
            model: 'glm-4.5',
            tokensIn: 100,
            tokensOut: 80,
            costUsd: 0,
          });
        },
      );

      await expect(worker.processNextJob()).resolves.toBe(true);

      expect(generatorClient.chat).toHaveBeenCalledTimes(1);
      expect(validatorClient.chat).toHaveBeenCalledTimes(1);
      expect(repo.saveGeneratedBankVariants).toHaveBeenCalledTimes(1);

      const savedCall = repo.saveGeneratedBankVariants.mock
        .calls[0] as unknown[];
      const savedArg = savedCall[0] as {
        senseId: bigint;
        languageId: number;
        generatorModel: string;
        validatorModel: string;
        variants: {
          skill: string;
          variantNo: number;
          excludedWords: string[];
        }[];
      };
      expect(savedArg.senseId).toBe(501n);
      expect(savedArg.generatorModel).toBe('deepseek-chat');
      expect(savedArg.validatorModel).toBe('glm-4.5');
      // 1 context_cloze + 1 context_meaning + 1 kanji_reading = 3 approved variants!
      expect(savedArg.variants).toHaveLength(3);
      const clozeVariant = savedArg.variants.find(
        (v) => v.skill === 'context_cloze',
      );
      expect(clozeVariant?.excludedWords).toEqual(
        expect.arrayContaining(['課題', '仕事', 'レポート']),
      );
      expect(repo.markGenerationJobDone).toHaveBeenCalledWith(501n);
    });

    it('reschedules or fails job with backoff when provider fails', async () => {
      const { worker, repo, generatorClient } = makeSetup();
      repo.claimNextGenerationJob.mockResolvedValue({
        senseId: 777n,
        languageId: 1,
        priority: 10,
        attempts: 3,
        replenishCycles: 0,
      });
      repo.loadPublicSenseForBank.mockResolvedValue({
        senseId: 777n,
        languageId: 1,
        languageCode: 'en',
        lemma: 'ticket',
        pos: 'noun',
        lexemeAttributes: null,
        glossVi: 'vé',
        glossEn: ['ticket'],
        kanjiPairs: [],
      });
      generatorClient.chat.mockRejectedValue(new Error('provider HTTP 503'));

      await expect(worker.processNextJob()).resolves.toBe(true);
      expect(repo.rescheduleOrFailGenerationJob).toHaveBeenCalledWith(
        expect.objectContaining({
          senseId: 777n,
          attempts: 3,
        }),
      );
    });
  });
});
