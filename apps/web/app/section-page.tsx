import { AppShell } from "./app-shell";

type SectionPageProps = {
  activePath: string;
  eyebrow: string;
  title: string;
  summary: string;
  items: Array<{ label: string; value: string; note: string }>;
};

export function SectionPage({ activePath, eyebrow, title, summary, items }: SectionPageProps) {
  return (
    <AppShell activePath={activePath} eyebrow={eyebrow} title={title}>
      <section className="sectionBand">
        <p>{summary}</p>
      </section>
      <section className="sectionGrid">
        {items.map((item) => (
          <article className="metric" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <p>{item.note}</p>
          </article>
        ))}
      </section>
    </AppShell>
  );
}
