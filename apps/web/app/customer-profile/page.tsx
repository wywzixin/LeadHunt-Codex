import { AppShell } from "../app-shell";
import { CustomerProfileForm } from "./customer-profile-form";

export default function CustomerProfilePage() {
  return (
    <AppShell
      activePath="/customer-profile"
      eyebrow="客户画像"
      frameVariant="letter"
      hidePageHeader
      mainClassName="productProfileMain"
      pageClassName="productProfilePage"
      title="客户画像"
    >
      <CustomerProfileForm />
    </AppShell>
  );
}
