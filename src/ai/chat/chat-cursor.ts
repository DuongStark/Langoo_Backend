import {
  decodeBigintTimeCursor,
  decodeUuidTimeCursor,
  encodeTimeIdCursor,
} from '../../common/pagination/time-cursor';

export interface ChatSessionCursor {
  createdAt: Date;
  id: string;
}

export interface ChatMessageCursor {
  createdAt: Date;
  id: bigint;
}

export function encodeChatSessionCursor(cursor: ChatSessionCursor): string {
  return encodeTimeIdCursor({
    createdAt: cursor.createdAt,
    id: cursor.id,
  });
}

export function decodeChatSessionCursor(raw: string): ChatSessionCursor {
  return decodeUuidTimeCursor(raw);
}

export function encodeChatMessageCursor(cursor: ChatMessageCursor): string {
  return encodeTimeIdCursor({
    createdAt: cursor.createdAt,
    id: cursor.id.toString(),
  });
}

export function decodeChatMessageCursor(raw: string): ChatMessageCursor {
  return decodeBigintTimeCursor(raw);
}
