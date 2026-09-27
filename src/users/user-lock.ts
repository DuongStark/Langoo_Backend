import { Prisma } from '../generated/prisma/client';

/** Serialize mutations that can change a user's profile/settings invariants. */
export async function lockUser(
  tx: Prisma.TransactionClient,
  userId: bigint,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM app.users WHERE id = ${userId} FOR UPDATE`;
}
