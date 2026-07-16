export default function Sidebar({ sources, active, onSelect }) {
  return (
    <nav>
      <div className="brand">🏁 FormulaDash</div>
      {sources.map((s) => (
        <button
          key={s.id}
          className={"nav-item" + (s.id === active ? " active" : "")}
          onClick={() => onSelect(s.id)}
        >
          <span className="nav-label">
            {s.live && <span className="live-dot" />}
            {s.label}
          </span>
          <span className="nav-sub">{s.sub}</span>
        </button>
      ))}
    </nav>
  );
}
