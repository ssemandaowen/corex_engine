import React from "react";
import { LogOut, ShieldCheck } from "lucide-react";

const SignOutView = ({ user, onCancel, onConfirm }) => {
  return (
    <div className="h-full w-full p-6">
      <div className="h-full ui-panel flex items-center justify-center">
        <div className="w-full max-w-xl ui-card">
          <div className="flex items-center gap-3 mb-4">
            <ShieldCheck size={20} className="text-[var(--ui-accent)]" />
            <h2 className="ui-title text-lg">Sign Out</h2>
          </div>
          <p className="ui-subtitle mb-6">
            You are signed in as <span className="mono text-[var(--ui-text)]">{user?.email || "authenticated user"}</span>.
            Confirm to end this session.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button className="ui-button ui-button-secondary" onClick={onCancel}>Stay Signed In</button>
            <button className="ui-button ui-button-danger" onClick={onConfirm}>
              <LogOut size={14} /> Sign Out Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignOutView;
