import { useQuery } from "@tanstack/react-query";
import { Button, Status } from "../components/ui";
import { RequireAccount } from "../components/require-account";
import { Shell } from "../components/shell";
import { api } from "../lib/api";
import { useAction } from "../lib/action";
import { m } from "../paraglide/messages";

export function Connect() {
  const query = window.location.search.slice(1);
  return (
    <Shell>
      <section className="account-card narrow">
        <h1>{m.connect_title()}</h1>
        <RequireAccount next={`/connect?${query}`}>
          {({ profile }) => <Consent query={query} handle={profile.handle!} />}
        </RequireAccount>
      </section>
    </Shell>
  );
}

function Consent({ query, handle }: { query: string; handle: string }) {
  const params = new URLSearchParams(query);
  const clientId = params.get("client_id");
  const client = useQuery({
    queryKey: ["oauth-client", clientId],
    enabled: !!clientId && params.has("sig"),
    retry: false,
    queryFn: () =>
      api<{ client_name?: string; redirect_uris: string[] }>(
        `/auth/oauth2/public-client?client_id=${encodeURIComponent(clientId!)}`,
      ),
  });
  const decision = useAction(async (accept: boolean) => {
    const result = await api<{ url: string }>("/auth/oauth2/consent", {
      accept,
      oauth_query: query,
    });
    // Only Better Auth's validated, registered callback is followed.
    window.location.assign(result.url);
  });
  if (!clientId || !params.has("sig") || client.error)
    return <Status error>{m.connect_invalid()}</Status>;
  if (client.isPending) return <p role="status">{m.common_loading()}</p>;
  return (
    <>
      <p>
        {m.connect_request({
          client: client.data.client_name || clientId,
          handle,
        })}
      </p>
      <p>{m.connect_scope()}</p>
      {params.get("scope")?.split(" ").includes("offline_access") && (
        <p>{m.connect_offline()}</p>
      )}
      <p className="muted">
        {m.connect_callback({ uri: params.get("redirect_uri") || "" })}
      </p>
      <div className="actions">
        <Button
          variant="primary"
          disabled={decision.busy}
          onClick={() => decision.run(true)}
        >
          {m.connect_allow()}
        </Button>
        <Button disabled={decision.busy} onClick={() => decision.run(false)}>
          {m.connect_deny()}
        </Button>
      </div>
      {decision.error && <Status error>{decision.error}</Status>}
    </>
  );
}
