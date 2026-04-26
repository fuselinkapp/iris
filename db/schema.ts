import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const epoch = (name: string) => integer(name, { mode: 'timestamp_ms' });

export const domains = sqliteTable(
  'domains',
  {
    id: text('id').primaryKey(),
    domain: text('domain').notNull(),
    verifiedAt: epoch('verified_at'),
    dkimStatus: text('dkim_status').notNull().default('pending'),
    resendDomainId: text('resend_domain_id'),
    resendVerifiedAt: epoch('resend_verified_at'),
    createdAt: epoch('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    domainIdx: uniqueIndex('domains_domain_idx').on(t.domain),
  }),
);

export const mailboxes = sqliteTable(
  'mailboxes',
  {
    id: text('id').primaryKey(),
    domainId: text('domain_id')
      .notNull()
      .references(() => domains.id, { onDelete: 'cascade' }),
    localPart: text('local_part').notNull(),
    displayName: text('display_name'),
    createdAt: epoch('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    addressIdx: uniqueIndex('mailboxes_address_idx').on(t.domainId, t.localPart),
  }),
);

export const threads = sqliteTable(
  'threads',
  {
    id: text('id').primaryKey(),
    mailboxId: text('mailbox_id')
      .notNull()
      .references(() => mailboxes.id, { onDelete: 'cascade' }),
    subject: text('subject').notNull(),
    snippet: text('snippet').notNull().default(''),
    lastMessageAt: epoch('last_message_at').notNull(),
    messageCount: integer('message_count').notNull().default(0),
    unreadCount: integer('unread_count').notNull().default(0),
    createdAt: epoch('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    mailboxRecentIdx: index('threads_mailbox_recent_idx').on(t.mailboxId, t.lastMessageAt),
  }),
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    fromAddress: text('from_address').notNull(),
    fromName: text('from_name'),
    toAddresses: text('to_addresses').notNull().default('[]'),
    ccAddresses: text('cc_addresses').notNull().default('[]'),
    bccAddresses: text('bcc_addresses').notNull().default('[]'),
    subject: text('subject').notNull(),
    html: text('html'),
    text: text('text'),
    headers: text('headers').notNull().default('{}'),
    rawR2Key: text('raw_r2_key'),
    readAt: epoch('read_at'),
    receivedAt: epoch('received_at').notNull(),
  },
  (t) => ({
    threadIdx: index('messages_thread_idx').on(t.threadId, t.receivedAt),
  }),
);

export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(),
  messageId: text('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  r2Key: text('r2_key').notNull(),
});

export const labels = sqliteTable(
  'labels',
  {
    id: text('id').primaryKey(),
    mailboxId: text('mailbox_id')
      .notNull()
      .references(() => mailboxes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('#888'),
    createdAt: epoch('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    nameIdx: uniqueIndex('labels_name_idx').on(t.mailboxId, t.name),
  }),
);

export const messageLabels = sqliteTable(
  'message_labels',
  {
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.messageId, t.labelId] }),
  }),
);

export const contacts = sqliteTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name'),
    lastSeenAt: epoch('last_seen_at'),
    createdAt: epoch('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    emailIdx: uniqueIndex('contacts_email_idx').on(t.email),
  }),
);

export type Domain = typeof domains.$inferSelect;
export type Mailbox = typeof mailboxes.$inferSelect;
export type Thread = typeof threads.$inferSelect;
export type Message = typeof messages.$inferSelect;
