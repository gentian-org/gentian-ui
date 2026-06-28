type UserMenuProps = {
  username: string;
  onLogout: () => void;
};

export function UserMenu({ username, onLogout }: UserMenuProps) {
  return (
    <div className="fixed right-4 top-4 z-50 flex items-center gap-3 text-sm">
      <span className="rounded-full bg-white/90 px-3 py-1 shadow-sm">{username}</span>
      <button
        type="button"
        onClick={onLogout}
        className="rounded-[var(--gtn-r2)] border border-[var(--gtn-border)] bg-white/90 px-3 py-1 hover:bg-white"
      >
        Sign out
      </button>
    </div>
  );
}
