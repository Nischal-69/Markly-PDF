import { Logo } from "@/components/branding/Logo";
import { Icon, type IconName } from "@/components/icons/Icon";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { usePdfStore, type SidebarView } from "@/state/pdfStore";

const NAV: Array<{ id: SidebarView; label: string; icon: IconName }> = [
  { id: "home", label: "Home", icon: "home" },
  { id: "recent", label: "Recent", icon: "recent" },
  { id: "notes", label: "Notes", icon: "note" },
  { id: "bookmarks", label: "Bookmarks", icon: "bookmark" },
];

export function Sidebar() {
  const sidebarView = usePdfStore((s) => s.sidebarView);
  const screen = usePdfStore((s) => s.screen);
  const setSidebarView = usePdfStore((s) => s.setSidebarView);
  const fileName = usePdfStore((s) => s.fileName);

  return (
    <aside className="sidebar" aria-label="Markly PDF navigation">
      <div className="sidebar-brand">
        <Logo />
      </div>

      <nav className="sidebar-nav">
        {NAV.map((item) => {
          const active = screen === "library" && sidebarView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`sidebar-item${active ? " is-active" : ""}`}
              onClick={() => setSidebarView(item.id)}
              aria-current={active ? "page" : undefined}
              title={item.label}
            >
              <Icon name={item.icon} size={17} />
              <span className="sidebar-item-label">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {screen === "viewer" && fileName && (
        <div className="sidebar-doc">
          <div className="sidebar-doc-caption">Currently reading</div>
          <div className="sidebar-doc-name" title={fileName}>
            {fileName}
          </div>
        </div>
      )}

      <div className="sidebar-footer">
        <ThemeSwitcher />
        <span className="sidebar-version">Markly PDF v0.1.0</span>
        <span className="sidebar-offline">
          <Icon name="check" size={12} /> Works offline
        </span>
      </div>
    </aside>
  );
}
