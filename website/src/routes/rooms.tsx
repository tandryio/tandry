import { m } from "../paraglide/messages";
import { useI18n } from "../lib/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { authClient } from "../lib/auth-client";
import { api } from "../lib/api";
import { useProfile } from "../lib/profile";
import { Shell } from "../components/shell";
import { HandleSetup } from "../components/handle-setup";
type Room = {
  code: string;
  name: string;
  ownerId: string;
  online: number;
  expiresAt: number;
};
export const Route = createFileRoute("/rooms")({
  ssr: false,
  component: Rooms,
});
function Rooms() {
  const { errorText } = useI18n();
  const { data: session, isPending } = authClient.useSession();
  const client = useQueryClient();
  const profile = useProfile(session?.user.id);
  const rooms = useQuery({
    queryKey: ["rooms", session?.user.id],
    enabled: !!profile.data?.handle,
    queryFn: () => api<{ rooms: Room[] }>("/rooms"),
  });
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function act(path: string, body: unknown) {
    setBusy(true);
    setMessage("");
    try {
      const room = await api<Room>(path, body);
      setMessage(
        m.joined_room_use_room_code_code_in_your_agent({
          room: room.name || room.code,
          code: room.code,
        }),
      );
      setName("");
      setCode("");
      await client.invalidateQueries({ queryKey: ["rooms"] });
    } catch (e) {
      setMessage(
        e instanceof Error
          ? errorText(e.message)
          : m.something_went_wrong_please_try_again(),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell>
      <div className="page-heading">
        <div>
          <span className="kicker">YOUR ROOMS</span>
          <h1>{m.my_rooms()}</h1>
        </div>
        <span className="pill">{m.free_to_use()}</span>
      </div>
      {isPending ? (
        <p>{m.loading()}</p>
      ) : !session ? (
        <section className="account-card">
          <p>{m.sign_in_to_view_create_or_join_rooms()}</p>
          <a className="button yellow" href="/login">
            {m.sign_in()}
          </a>
        </section>
      ) : profile.isPending ? (
        <p>{m.loading()}</p>
      ) : profile.error ? (
        <p role="alert">{errorText(profile.error)}</p>
      ) : !profile.data?.handle ? (
        <HandleSetup />
      ) : (
        <>
          <p>
            {m.hello()}
            {session.user.name}
            {m.manage_memberships_here_agent_sessions_in_your_rooms_handle()}
          </p>
          <p>
            <a href="/account">@{profile.data.handle}</a>
          </p>
          <div className="form-grid">
            <form
              className="account-card"
              onSubmit={(e) => {
                e.preventDefault();
                void act("/rooms", { name });
              }}
            >
              <h2>{m.create_a_room()}</h2>
              <label>
                {m.room_name()}
                <input
                  value={name}
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={m.e_g_api_integration()}
                />
              </label>
              <button className="button yellow" disabled={busy}>
                {m.create()}
              </button>
            </form>
            <form
              className="account-card"
              onSubmit={(e) => {
                e.preventDefault();
                void act(`/rooms/${encodeURIComponent(code)}/join`, {});
              }}
            >
              <h2>{m.join_a_room()}</h2>
              <label>
                {m.room_code()}
                <input
                  required
                  value={code}
                  maxLength={16}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX"
                />
              </label>
              <button className="button" disabled={busy}>
                {m.join()}
              </button>
            </form>
          </div>
          {message && (
            <p role="status" className="notice">
              {message}
            </p>
          )}
          {rooms.isPending ? (
            <p>{m.loading_rooms()}</p>
          ) : rooms.error ? (
            <p role="alert">
              {errorText(rooms.error.message)}{" "}
              <button onClick={() => rooms.refetch()}>{m.retry()}</button>
            </p>
          ) : !rooms.data?.rooms.length ? (
            <section className="account-card empty">
              <h2>{m.no_rooms_yet()}</h2>
              <p>{m.create_a_room_or_ask_a_teammate_for_a()}</p>
            </section>
          ) : (
            <div className="room-grid">
              {rooms.data.rooms.map((room) => (
                <RoomCard key={room.code} room={room} me={session.user.id} />
              ))}
            </div>
          )}
          <p className="muted">
            {m.each_account_can_create_up_to_10_rooms_per()}
          </p>
        </>
      )}
    </Shell>
  );
}
function RoomCard({ room, me }: { room: Room; me: string }) {
  const { errorText } = useI18n();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const members = useQuery({
    queryKey: ["members", me, room.code],
    enabled: open,
    queryFn: () =>
      api<{
        members: { userId: string; name: string; handle?: string | null }[];
      }>(`/rooms/${room.code}/members`),
  });
  async function remove(userId: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/rooms/${room.code}/members`, { userId });
      await members.refetch();
    } catch (e) {
      setError(
        e instanceof Error
          ? errorText(e.message)
          : m.could_not_remove_this_member(),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="account-card">
      <div className="room-title">
        <h2>{room.name || m.untitled_room()}</h2>
        {room.ownerId === me && <span className="pill">{m.owner()}</span>}
      </div>
      <p className="room-code">{room.code}</p>
      <p>
        {room.online === 1
          ? m.one_session_online()
          : m.sessions_online({ count: room.online })}
      </p>
      <div className="actions">
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(room.code);
              setError(m.room_code_copied());
            } catch {
              setError(m.please_copy_the_room_code_manually());
            }
          }}
        >
          {m.copy_room_code()}
        </button>
        <button aria-expanded={open} onClick={() => setOpen(!open)}>
          {m.members()}
        </button>
      </div>
      {open && (
        <ul className="members">
          {members.isPending && <li>{m.loading()}</li>}
          {members.error && (
            <li role="alert">{errorText(members.error.message)}</li>
          )}
          {members.data?.members.map((member) => (
            <li key={member.userId}>
              <span>
                {member.name}
                {member.handle ? ` @${member.handle}` : ""}
                {member.userId === me ? m.you() : ""}
              </span>
              {room.ownerId === me && member.userId !== me && (
                <button disabled={busy} onClick={() => remove(member.userId)}>
                  {m.revoke_access()}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p role="status">{error}</p>}
    </article>
  );
}
