import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

interface Gate {
  intervalMs: number;
  nextAt: number;
  tail: Promise<void>;
}
/** Process-wide, shared across quiz/chat transports using the same model scope. */
export class AiModelDispatch {
  private static readonly gates = new Map<string, Gate>();
  static scope(baseUrl: string, apiKey: string, model: string): string {
    return createHash('sha256')
      .update(JSON.stringify([baseUrl.replace(/\/+$/, ''), apiKey, model]))
      .digest('hex');
  }
  static configure(scope: string, intervalMs: number): void {
    const existing = this.gates.get(scope);
    if (existing)
      existing.intervalMs = Math.max(existing.intervalMs, intervalMs);
    else
      this.gates.set(scope, { intervalMs, nextAt: 0, tail: Promise.resolve() });
  }
  static async run<T>(
    scope: string,
    signal: AbortSignal,
    before: (() => Promise<void>) | undefined,
    start: () => Promise<T>,
  ): Promise<T> {
    const gate = this.gates.get(scope);
    let response: Promise<T>;
    const dispatch = async () => {
      signal.throwIfAborted();
      while (gate && gate.nextAt > Date.now())
        await delay(gate.nextAt - Date.now(), undefined, { signal });
      signal.throwIfAborted();
      await before?.();
      signal.throwIfAborted();
      if (gate) gate.nextAt = Date.now() + gate.intervalMs;
      // Invoke fetch before releasing the gate, but never await the response
      // while holding it: pacing controls starts rather than serialization.
      response = start();
    };
    if (!gate) await dispatch();
    else {
      const turn = gate.tail.then(dispatch);
      gate.tail = turn.catch(() => undefined);
      await turn;
    }
    return response!;
  }
  static async wait(
    scope: string,
    signal: AbortSignal,
    before?: () => Promise<void>,
  ): Promise<void> {
    return this.run(scope, signal, before, () => Promise.resolve());
  }
}
