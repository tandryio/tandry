import { m } from "../../paraglide/messages";

function Line({ width = "100%" }: { width?: string }) {
  return <span className="room-skeleton-line" style={{ width }} />;
}

export function MembersSkeleton() {
  return (
    <div
      className="room-skeleton-members"
      role="status"
      aria-label={m.common_loading()}
    >
      <div aria-hidden="true">
        {["72%", "58%", "80%", "64%"].map((width) => (
          <div className="room-skeleton-member" key={width}>
            <span className="room-skeleton-avatar" />
            <div>
              <Line width={width} />
              <Line width="42%" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MessagesSkeleton() {
  return (
    <div
      className="room-skeleton-messages"
      role="status"
      aria-label={m.common_loading()}
    >
      <div aria-hidden="true">
        {[false, false, true, false].map((own, index) => (
          <div
            className={`room-skeleton-message${own ? " is-own" : ""}`}
            key={index}
          >
            <span className="room-skeleton-avatar" />
            <div className="room-skeleton-message-content">
              <Line width={index % 2 ? "30%" : "42%"} />
              <div className="room-skeleton-bubble">
                <Line />
                <Line width={index % 2 ? "58%" : "82%"} />
                {index === 1 && <Line width="68%" />}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RoomsSkeleton({ detail = false }: { detail?: boolean }) {
  return (
    <div className="room-skeleton-page" aria-busy="true">
      <div className="room-skeleton-heading" aria-hidden="true">
        <Line width="170px" />
        <Line width="110px" />
      </div>
      {detail ? (
        <div className="room-chat-body">
          <aside className="room-chat-side">
            <MembersSkeleton />
          </aside>
          <section className="chat">
            <MessagesSkeleton />
          </section>
        </div>
      ) : (
        <div
          className="room-skeleton-cards"
          role="status"
          aria-label={m.rooms_loading()}
        >
          {[0, 1, 2].map((index) => (
            <div className="room-skeleton-card" aria-hidden="true" key={index}>
              <Line width="38%" />
              <Line width="72%" />
              <Line width="23%" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
