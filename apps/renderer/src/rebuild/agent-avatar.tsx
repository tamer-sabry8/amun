// An agent's picture: its animal from the catalogue, or its initial for an
// agent the user added. Pictures are the CC0 Animoon set, bundled locally.
import { agentProfile } from "../../../../packages/domain/src/work/agents.ts";

export function AgentAvatar({
  role,
  size = 52,
}: {
  role: string;
  size?: number;
}) {
  const profile = agentProfile(role);
  return (
    <span
      className="rb-avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden="true"
    >
      {profile ? (
        <img
          src={`./avatars/${profile.avatar}.webp`}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          style={profile.mirrored ? { transform: "scaleX(-1)" } : undefined}
        />
      ) : (
        role.trim().charAt(0).toUpperCase()
      )}
    </span>
  );
}
