import { AppShell } from "../app-shell";
import { MailboxClient } from "./mailbox-client";

export default function MailboxPage() {
  return (
    <AppShell
      activePath="/mailbox"
      eyebrow="个人邮箱"
      hidePageHeader
      mainClassName="mailboxMain"
      pageClassName="mailboxPage"
      title="个人邮箱"
    >
      <MailboxClient />
    </AppShell>
  );
}
