// Stands in for a section that is not built yet, and says when it arrives.
export default function SectionNote({ section }) {
  return (
    <section className="abm-note" aria-label={section.label}>
      <h2>{section.label}</h2>
      <p>{section.note}</p>
      <p className="abm-note-phase">Planned for phase {section.phase}.</p>
    </section>
  );
}
