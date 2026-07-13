export interface BotMessage {
  from: string; // sender phone (e.g. "919876543210@s.whatsapp.net")
  senderName: string;
  text: string;
  groupId: string; // group JID (e.g. "120363xxxx@g.us")
  messageId: string;
  isGroup: boolean;
  timestamp: number;
  quotedMessageId?: string; // if replying to a message
}

export interface CommandResult {
  response: string;
  mentions?: string[]; // WhatsApp JIDs to @mention in the reply (e.g. ["13135550002@c.us"])
  additionalMessages?: Array<{ text: string; delayMs?: number }>; // extra messages sent in sequence
  mediaFile?: string;    // absolute path to an image/video to send alongside the response
  mediaCaption?: string; // caption for the media file
  mediaAsVoice?: boolean; // send audio media as a WhatsApp voice note
}
