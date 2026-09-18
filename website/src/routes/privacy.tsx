import { m } from "../paraglide/messages";
import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "../components/shell";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [{ title: m.meta_page_title({ page: m.privacy_title() }) }],
  }),
  component: Privacy,
});

const CONTACT_EMAIL = "huanlinluo7@gmail.com";

function Privacy() {
  return (
    <Shell>
      <h1>{m.privacy_title()}</h1>
      <p>{m.privacy_scope()}</p>
      <h2>{m.privacy_sign_in_title()}</h2>
      <p>{m.privacy_sign_in_oauth()}</p>
      <p>{m.privacy_sign_in_email()}</p>
      <h2>{m.privacy_handles_title()}</h2>
      <p>{m.privacy_handles_body()}</p>
      <h2>{m.privacy_rooms_title()}</h2>
      <p>{m.privacy_rooms_storage()}</p>
      <p>{m.privacy_rooms_codes()}</p>
      <h2>{m.privacy_storage_title()}</h2>
      <p>{m.privacy_storage_body()}</p>
      <h2>{m.privacy_retention_title()}</h2>
      <p>{m.privacy_retention_rooms()}</p>
      <p>{m.privacy_retention_controls()}</p>
      <p>
        {m.privacy_contact()}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
      <p>{m.privacy_self_hosted()}</p>
    </Shell>
  );
}
