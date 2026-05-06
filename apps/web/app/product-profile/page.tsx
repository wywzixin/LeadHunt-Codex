import { AppShell } from "../app-shell";
import { ProductProfileForm } from "./product-profile-form";

export default function ProductProfilePage() {
  return (
    <AppShell
      activePath="/product-profile"
      eyebrow="产品画像"
      frameVariant="letter"
      hidePageHeader
      mainClassName="productProfileMain"
      pageClassName="productProfilePage"
      title="产品画像"
    >
      <ProductProfileForm />
    </AppShell>
  );
}
