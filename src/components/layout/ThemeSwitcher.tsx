import { Icon, type IconName } from "@/components/icons/Icon";
import { useThemeStore, type ThemeSetting } from "@/state/themeStore";

const OPTIONS: Array<{ id: ThemeSetting; label: string; icon: IconName; hint: string }> = [
  { id: "light", label: "Light", icon: "sun", hint: "Light mode" },
  { id: "dark", label: "Dark", icon: "moon", hint: "Dark mode" },
  { id: "system", label: "System", icon: "monitor", hint: "Follow the system theme" },
];

/**
 * Batch 9 — appearance switcher in the sidebar footer.
 * A compact segmented control (radiogroup) so the choice is a single
 * Tab stop with arrow-key support via native radio semantics.
 */
export function ThemeSwitcher() {
  const setting = useThemeStore((s) => s.setting);
  const setSetting = useThemeStore((s) => s.setSetting);

  return (
    <div className="theme-switch-wrap">
      <span className="theme-switch-caption" id="theme-switch-label">
        Appearance
      </span>
      <div
        className="theme-switch"
        role="radiogroup"
        aria-labelledby="theme-switch-label"
      >
        {OPTIONS.map((opt) => {
          const checked = setting === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={checked}
              className={`theme-option${checked ? " is-active" : ""}`}
              onClick={() => setSetting(opt.id)}
              title={opt.hint}
              aria-label={opt.hint}
            >
              <Icon name={opt.icon} size={14} />
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
