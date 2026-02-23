import React from "react";

const hash = (input = "") => {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
};

const initialsFrom = (name = "", email = "") => {
  const source = String(name || email || "U").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
};

const gradientFrom = (seed = "") => {
  const h = hash(seed) % 360;
  const h2 = (h + 42) % 360;
  return `linear-gradient(135deg, hsl(${h} 78% 48%), hsl(${h2} 78% 58%))`;
};

const UserAvatar = ({ name, email, size = 32 }) => {
  const initials = initialsFrom(name, email);
  const gradient = gradientFrom(`${name || ""}|${email || ""}`);
  return (
    <div
      title={name || email || "User"}
      className="inline-flex items-center justify-center rounded-full text-white font-bold mono"
      style={{
        width: size,
        height: size,
        background: gradient,
        boxShadow: "0 0 0 1px rgba(148,163,184,0.35)"
      }}
    >
      <span style={{ fontSize: Math.max(10, Math.floor(size / 2.6)) }}>{initials}</span>
    </div>
  );
};

export default UserAvatar;
