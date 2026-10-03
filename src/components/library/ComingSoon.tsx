import { Icon, type IconName } from "@/components/icons/Icon";

interface ComingSoonProps {
  icon: IconName;
  title: string;
  description: string;
}

/** Placeholder for Batch 2 areas — keeps navigation honest, no dead ends. */
export function ComingSoon({ icon, title, description }: ComingSoonProps) {
  return (
    <div className="library-scroll">
      <section className="coming-soon">
        <span className="coming-soon-icon" aria-hidden="true">
          <Icon name={icon} size={30} />
        </span>
        <h1>{title}</h1>
        <p>{description}</p>
        <span className="soon-chip soon-chip-large">Coming in a later batch</span>
      </section>
    </div>
  );
}
