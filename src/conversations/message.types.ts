export type MessageAuthor = "lead" | "humano" | "ia";

export interface ConversationMessage {
  id: string;
  autor: MessageAuthor;
  texto: string;
  timestamp: Date;
  message_id: string;
}
