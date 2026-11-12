import type { GuestItem, OwnerGuest, OwnerItem, SideGift } from "../domain/types.js";
import type { LocaleCode, Translate } from "../i18n/index.js";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DraftAddRow,
  ExternalLinkIcon,
  InlineDraftEdit,
  formatHost,
  formatMoney,
  formatOccasionDate,
} from "./components.js";
import { Layout } from "./layout.js";
import type {
  CreateListPage,
  CreatedPage,
  GuestListPage,
  JoinPage,
  OwnerPage,
  ShareLinks,
} from "./props.js";

function renderCreateListError(error: CreateListPage["error"], t: Translate) {
  if (!error) return null;
  switch (error) {
    case "invalid":
      return (
        <div class="flash flash-err" role="alert">
          {t("error.invalid")}
        </div>
      );
    case "rate-limited":
      return (
        <div class="flash flash-err" role="alert">
          {t("error.rate_limited")}
        </div>
      );
    default: {
      const _exhaustive: never = error;
      return _exhaustive;
    }
  }
}

export function CreateListView(p: CreateListPage) {
  const { t } = p.chrome;
  return (
    <Layout chrome={p.chrome} title={t("create.page_title")}>
      <section class="hero-block">
        <h1>{t("create.heading")}</h1>
        <p class="lead-copy">{t("create.intro")}</p>
      </section>

      {renderCreateListError(p.error, t)}

      <div class="surface-card surface-card-accent">
        <form method="post" action="/lists" class="stack-form">
          <div class="field-group">
            <label for="create-title">{t("create.title_label")}</label>
            <input
              id="create-title"
              name="title"
              type="text"
              required
              maxlength={120}
              placeholder={t("create.title_placeholder")}
            />
          </div>

          <div class="field-row">
            <div class="field-group">
              <label for="create-owner-name">{t("create.owner_name_label")}</label>
              <input
                id="create-owner-name"
                name="ownerName"
                type="text"
                required
                maxlength={120}
                autocomplete="name"
                placeholder={t("create.owner_name_placeholder")}
              />
            </div>

            <div class="field-group">
              <label for="create-occasion-date">
                <span>{t("create.occasion_date_label")}</span>
                <span class="field-optional">{t("common.optional")}</span>
              </label>
              <input id="create-occasion-date" name="occasionDate" type="date" />
            </div>
          </div>

          <div class="field-group">
            <label for="create-owner-email">{t("create.owner_email_label")}</label>
            <input
              id="create-owner-email"
              name="ownerEmail"
              type="email"
              required
              maxlength={254}
              autocomplete="email"
              aria-describedby="create-email-hint"
              placeholder={t("create.owner_email_placeholder")}
            />
            <p id="create-email-hint" class="field-hint">
              {t("create.owner_email_hint")}
            </p>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary btn-wide">
              {t("create.submit")}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}

export function CreatedView(p: CreatedPage) {
  const { t } = p.chrome;
  return (
    <Layout chrome={p.chrome} title={t("created.page_title", { title: p.list.title })}>
      <section class="hero-block">
        <h1>{t("created.heading")}</h1>
        <p class="lead-copy">
          {p.emailSent
            ? t("created.email_sent", { email: p.list.ownerEmail })
            : t("created.email_not_sent")}
        </p>
      </section>

      <div class="surface-card surface-card-accent">
        <div class="field-group">
          <label for="manage-url-input">{t("created.manage_link_label")}</label>
          <input
            id="manage-url-input"
            type="url"
            readonly
            value={p.manageUrl}
            class="secret-url-input"
          />
        </div>
        <div class="action-cluster">
          <a href={p.manageUrl} class="btn btn-primary">
            {t("created.open_list")}
          </a>
          <button
            type="button"
            class="btn btn-secondary"
            hidden
            data-share-copy
            data-share-text={p.manageUrl}
            data-copied-label={t("common.copied")}
          >
            {t("common.copy_link")}
          </button>
        </div>
      </div>
    </Layout>
  );
}

function renderOwnerFlash(flash: OwnerPage["flash"], t: Translate) {
  if (!flash) return null;
  switch (flash) {
    case "guest-added":
      return (
        <div class="flash flash-ok" role="status">
          {t("owner.flash_guest_added")}
        </div>
      );
    case "mail-failed":
      return (
        <div class="flash flash-warn" role="alert">
          {t("owner.flash_mail_failed")}
        </div>
      );
    case "mail-capped":
      return (
        <div class="flash flash-warn" role="alert">
          {t("owner.flash_mail_throttled")}
        </div>
      );
    case "regen-mail-failed":
      return (
        <div class="flash flash-warn" role="alert">
          {t("owner.flash_regen_mail_failed")}
        </div>
      );
    case "invalid":
      return (
        <div class="flash flash-err" role="alert">
          {t("error.invalid")}
        </div>
      );
    default: {
      const _exhaustive: never = flash;
      return _exhaustive;
    }
  }
}

function renderDaysLeft(daysLeft: number | null, t: Translate) {
  if (daysLeft === null) return null;
  let text: string;
  if (daysLeft > 1) text = t("owner.days_left_many", { days: daysLeft });
  else if (daysLeft === 1) text = t("owner.days_left_one");
  else if (daysLeft === 0) text = t("owner.days_left_zero");
  else text = t("owner.days_passed");

  return <span class="pill pill-sun tabular">{text}</span>;
}

function OwnerChecklistRow({
  item,
  index,
  count,
  listId,
  listLocale,
  t,
}: {
  item: OwnerItem;
  index: number;
  count: number;
  listId: string;
  listLocale: LocaleCode;
  t: Translate;
}) {
  const itemBase = `/o/${listId}/items/${item.id}`;
  const checkLabel = item.received
    ? t("owner.unmark_received", { name: item.name })
    : t("owner.mark_received", { name: item.name });

  return (
    <li id={`item-${item.id}`} class={`checklist-row${item.received ? " is-received" : ""}`}>
      <div class="checklist-main">
        <form method="post" action={`${itemBase}/received`} class="check-form">
          <input type="hidden" name="received" value={item.received ? "0" : "1"} />
          <button
            type="submit"
            class={`round-check${item.received ? " is-checked" : ""}`}
            role="checkbox"
            aria-checked={item.received ? "true" : "false"}
            aria-label={checkLabel}
            title={checkLabel}
          >
            <span class="round-check-disc" aria-hidden="true">
              {item.received && <CheckIcon />}
            </span>
          </button>
        </form>

        <div class="item-body">
          <div class="item-title-line">
            <span class="item-name">{item.name}</span>
            {item.received && <span class="pill pill-mint">{t("owner.received_badge")}</span>}
            {item.priceCents !== null && (
              <span class="item-price tabular">{formatMoney(item.priceCents, listLocale)}</span>
            )}
          </div>

          {item.details && <p class="item-details">{item.details}</p>}

          {item.url && (
            <a
              href={item.url}
              class="item-link"
              target="_blank"
              rel="noopener noreferrer nofollow"
              aria-label={`${t("common.open_link")}: ${item.name}`}
            >
              <span>{formatHost(item.url)}</span>
              <ExternalLinkIcon />
            </a>
          )}
        </div>

        <div class="row-controls">
          <form method="post" action={`${itemBase}/move`} class="inline-form">
            <input type="hidden" name="direction" value="up" />
            <button
              type="submit"
              class="icon-btn"
              disabled={index === 0}
              aria-label={t("owner.move_up", { name: item.name })}
              title={t("owner.move_up", { name: item.name })}
            >
              <ChevronUpIcon />
            </button>
          </form>

          <form method="post" action={`${itemBase}/move`} class="inline-form">
            <input type="hidden" name="direction" value="down" />
            <button
              type="submit"
              class="icon-btn"
              disabled={index === count - 1}
              aria-label={t("owner.move_down", { name: item.name })}
              title={t("owner.move_down", { name: item.name })}
            >
              <ChevronDownIcon />
            </button>
          </form>

          <form method="post" action={`${itemBase}/delete`} class="inline-form">
            <button
              type="submit"
              class="btn-chip btn-danger-subtle"
              aria-label={t("owner.delete_item", { name: item.name })}
            >
              {t("common.delete")}
            </button>
          </form>
        </div>
      </div>

      <InlineDraftEdit
        action={itemBase}
        idPrefix={`edit-item-${item.id}`}
        draft={item}
        nameLabel={t("owner.add_item_label")}
        t={t}
      />
    </li>
  );
}

function GuestShareRow({
  guest,
  share,
  listId,
  t,
}: {
  guest: OwnerGuest;
  share: ShareLinks | undefined;
  listId: string;
  t: Translate;
}) {
  const guestBase = `/o/${listId}/guests/${guest.id}`;
  return (
    <li id={`guest-${guest.id}`} class="guest-row">
      <div class="guest-top">
        <div class="guest-identity">
          <span class="guest-name">{guest.name}</span>
          {guest.email && <span class="guest-email">{guest.email}</span>}
        </div>
        <div class="guest-badges">
          {!guest.joined && (
            <span class="pill pill-code tabular">
              {t("owner.guest_code_label", { code: guest.code })}
            </span>
          )}
          <span class={`pill ${guest.joined ? "pill-mint" : "pill-muted"}`}>
            {guest.joined ? t("owner.guest_joined") : t("owner.guest_invited")}
          </span>
        </div>
      </div>

      <div class="guest-actions-bar">
        {!guest.joined && share && (
          <div class="share-block" data-share-text={share.text} data-share-url={share.url}>
            <button
              type="button"
              class="btn-chip btn-chip-primary"
              hidden
              data-share-native
              data-share-text={share.text}
              data-share-url={share.url}
            >
              {t("owner.share_native")}
            </button>
            <button
              type="button"
              class="btn-chip"
              hidden
              data-share-copy
              data-share-text={share.text}
              data-copied-label={t("common.copied")}
            >
              {t("owner.share_copy")}
            </button>
            <a
              href={share.whatsapp}
              class="btn-chip"
              target="_blank"
              rel="noopener noreferrer nofollow"
            >
              {t("owner.share_whatsapp")}
            </a>
            <a
              href={share.telegram}
              class="btn-chip"
              target="_blank"
              rel="noopener noreferrer nofollow"
            >
              {t("owner.share_telegram")}
            </a>
            <a href={share.mailto} class="btn-chip">
              {t("owner.share_email")}
            </a>
          </div>
        )}

        <div class="guest-manage-forms">
          <form method="post" action={`${guestBase}/code`} class="inline-form">
            <button type="submit" class="btn-chip">
              {t("owner.regenerate_code")}
            </button>
          </form>
          <form method="post" action={`${guestBase}/delete`} class="inline-form">
            <button type="submit" class="btn-chip btn-danger-subtle">
              {t("owner.remove_guest")}
            </button>
          </form>
        </div>
      </div>
    </li>
  );
}

export function OwnerView(p: OwnerPage) {
  const { t } = p.chrome;
  return (
    <Layout chrome={p.chrome} title={t("owner.page_title", { title: p.list.title })}>
      {renderOwnerFlash(p.flash, t)}

      <header class="list-head">
        <h1>{p.list.title}</h1>
        <div class="list-meta">
          {renderDaysLeft(p.daysLeft, t)}
          {p.list.occasionDate && (
            <span class="meta-text">
              {formatOccasionDate(p.list.occasionDate, p.chrome.locale)}
            </span>
          )}
          <span class="meta-total tabular">
            {t("owner.total_label", { amount: formatMoney(p.totalCents, p.list.locale) })}
          </span>
        </div>
      </header>

      <section class="page-section" aria-labelledby="wishes-heading">
        <h2 id="wishes-heading">{t("owner.checklist_heading")}</h2>

        <DraftAddRow
          action={`/o/${p.list.id}/items`}
          idPrefix="owner-add-item"
          nameLabel={t("owner.add_item_label")}
          namePlaceholder={t("owner.add_item_placeholder")}
          submitLabel={t("owner.add_item_submit")}
          t={t}
        />

        {p.items.length === 0 ? (
          <p class="empty-state">{t("owner.empty_items")}</p>
        ) : (
          <ul class="checklist">
            {p.items.map((item, idx) => (
              <OwnerChecklistRow
                key={item.id}
                item={item}
                index={idx}
                count={p.items.length}
                listId={p.list.id}
                listLocale={p.list.locale}
                t={t}
              />
            ))}
          </ul>
        )}
      </section>

      <section class="page-section" aria-labelledby="guests-heading">
        <div class="section-head">
          <h2 id="guests-heading">{t("owner.guests_heading")}</h2>
          <p class="section-intro">{t("owner.guests_intro")}</p>
        </div>

        <form method="post" action={`/o/${p.list.id}/guests`} class="surface-card guest-add-form">
          <div class="field-row">
            <div class="field-group">
              <label for="add-guest-name">{t("owner.guest_name_label")}</label>
              <input
                id="add-guest-name"
                name="name"
                type="text"
                required
                maxlength={60}
                placeholder={t("owner.guest_name_placeholder")}
              />
            </div>
            <div class="field-group">
              <label for="add-guest-email">
                <span>{t("owner.guest_email_label")}</span>
                <span class="field-optional">{t("common.optional")}</span>
              </label>
              <input
                id="add-guest-email"
                name="email"
                type="email"
                maxlength={254}
                placeholder={t("owner.guest_email_placeholder")}
              />
            </div>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">
              {t("owner.add_guest_submit")}
            </button>
          </div>
        </form>

        {p.guests.length === 0 ? (
          <p class="empty-state">{t("owner.empty_guests")}</p>
        ) : (
          <ul class="guest-list">
            {p.guests.map((guest) => (
              <GuestShareRow
                key={guest.id}
                guest={guest}
                share={p.shares[guest.id]}
                listId={p.list.id}
                t={t}
              />
            ))}
          </ul>
        )}
      </section>
    </Layout>
  );
}

function renderJoinError(error: JoinPage["error"], ownerName: string, t: Translate) {
  if (!error) return null;
  switch (error) {
    case "wrong-code":
      return (
        <div class="flash flash-err" role="alert">
          {t("error.wrong_code")}
        </div>
      );
    case "code-used":
      return (
        <div class="flash flash-err" role="alert">
          {t("error.code_used", { owner: ownerName })}
        </div>
      );
    case "throttled":
      return (
        <div class="flash flash-err" role="alert">
          {t("error.throttled")}
        </div>
      );
    default: {
      const _exhaustive: never = error;
      return _exhaustive;
    }
  }
}

export function JoinView(p: JoinPage) {
  const { t } = p.chrome;
  const missingInvite = p.invite === null;
  return (
    <Layout chrome={p.chrome} title={t("join.page_title", { title: p.list.title })}>
      <section class="hero-block">
        <h1>{p.list.title}</h1>
        <p class="lead-copy">{t("join.subtitle", { owner: p.list.ownerName })}</p>
      </section>

      {renderJoinError(p.error, p.list.ownerName, t)}

      {missingInvite && (
        <div class="flash flash-warn" role="status">
          {t("join.missing_invite", { owner: p.list.ownerName })}
        </div>
      )}

      <div class="surface-card surface-card-accent join-card">
        <form method="post" action={`/l/${p.list.id}/join`} class="stack-form">
          {p.invite !== null && <input type="hidden" name="invite" value={p.invite} />}
          <div class="field-group">
            <label for="join-code">{t("join.code_label")}</label>
            <input
              id="join-code"
              name="code"
              type="text"
              inputmode="numeric"
              pattern="[0-9]{4}"
              maxlength={4}
              autocomplete="one-time-code"
              required
              disabled={missingInvite}
              placeholder={t("join.code_placeholder")}
              class="code-input tabular"
            />
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary btn-wide" disabled={missingInvite}>
              {t("join.submit")}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}

function renderGuestFlash(flash: GuestListPage["flash"], t: Translate) {
  if (!flash) return null;
  switch (flash) {
    case "already-taken":
      return (
        <div class="flash flash-err" role="alert">
          {t("error.already_taken")}
        </div>
      );
    case "invalid":
      return (
        <div class="flash flash-err" role="alert">
          {t("error.invalid")}
        </div>
      );
    default: {
      const _exhaustive: never = flash;
      return _exhaustive;
    }
  }
}

function GuestWishlistRow({
  item,
  listId,
  listLocale,
  t,
}: {
  item: GuestItem;
  listId: string;
  listLocale: LocaleCode;
  t: Translate;
}) {
  const { state } = item;
  const itemBase = `/l/${listId}/items/${item.id}`;

  switch (state.kind) {
    case "taken": {
      return (
        <li id={`item-${item.id}`} class="gift-row is-wrapped">
          <div class="gift-inner">
            <span class="sr-only">
              {t("guest.wrapped_sr_label", { name: item.name, by: state.byName })}
            </span>
            <span class="ribbon-stripe is-ribbon" aria-hidden="true"></span>

            <div class="wrapped-body" aria-hidden="true">
              <span class="round-state is-taken"></span>
              <div class="item-body">
                <div class="item-title-line">
                  <span class="item-name">{item.name}</span>
                  {item.priceCents !== null && (
                    <span class="item-price tabular">
                      {formatMoney(item.priceCents, listLocale)}
                    </span>
                  )}
                </div>
                {item.details && <p class="item-details">{item.details}</p>}
                {item.url && <span class="item-link">{formatHost(item.url)}</span>}
              </div>
            </div>

            <div class="gift-tag-dock">
              {item.received && <span class="pill pill-mint">{t("guest.received")}</span>}
              <span class="gift-tag is-ribbon">
                <span class="tag-hole" aria-hidden="true"></span>
                <span>{t("guest.tag_claimed_by", { name: state.byName })}</span>
              </span>
            </div>
          </div>
        </li>
      );
    }

    case "mine": {
      return (
        <li id={`item-${item.id}`} class="gift-row is-mine">
          <div class="gift-inner">
            <span class="ribbon-stripe is-mint" aria-hidden="true"></span>

            <div class="gift-main">
              <span class="round-state is-mine" aria-hidden="true">
                <CheckIcon />
              </span>

              <div class="item-body">
                <div class="item-title-line">
                  <span class="item-name">{item.name}</span>
                  {item.priceCents !== null && (
                    <span class="item-price tabular">
                      {formatMoney(item.priceCents, listLocale)}
                    </span>
                  )}
                </div>
                {item.details && <p class="item-details">{item.details}</p>}
                {item.url && (
                  <a
                    href={item.url}
                    class="item-link"
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    aria-label={`${t("common.open_link")}: ${item.name}`}
                  >
                    <span>{formatHost(item.url)}</span>
                    <ExternalLinkIcon />
                  </a>
                )}
              </div>

              <div class="gift-actions">
                <span class="gift-tag is-mint">
                  <span class="tag-hole" aria-hidden="true"></span>
                  <span>{t("guest.tag_you")}</span>
                </span>
                {item.received ? (
                  <span class="pill pill-mint">{t("guest.received")}</span>
                ) : (
                  <form method="post" action={`${itemBase}/unclaim`} class="inline-form">
                    <button type="submit" class="btn-chip">
                      {t("guest.unclaim")}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </li>
      );
    }

    case "free": {
      return (
        <li id={`item-${item.id}`} class={`gift-row is-free${item.received ? " is-received" : ""}`}>
          <div class="gift-inner">
            <div class="gift-main">
              <span
                class={`round-state${item.received ? " is-mine" : ""}`}
                aria-hidden="true"
              >
                {item.received && <CheckIcon />}
              </span>

              <div class="item-body">
                <div class="item-title-line">
                  <span class="item-name">{item.name}</span>
                  {item.priceCents !== null && (
                    <span class="item-price tabular">
                      {formatMoney(item.priceCents, listLocale)}
                    </span>
                  )}
                </div>
                {item.details && <p class="item-details">{item.details}</p>}
                {item.url && (
                  <a
                    href={item.url}
                    class="item-link"
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    aria-label={`${t("common.open_link")}: ${item.name}`}
                  >
                    <span>{formatHost(item.url)}</span>
                    <ExternalLinkIcon />
                  </a>
                )}
              </div>

              <div class="gift-actions">
                {item.received ? (
                  <span class="pill pill-mint">{t("guest.received")}</span>
                ) : (
                  <form method="post" action={`${itemBase}/claim`} class="inline-form">
                    <button type="submit" class="btn btn-primary">
                      {t("guest.claim")}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </li>
      );
    }

    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function SideGiftRow({
  idea,
  listId,
  listLocale,
  t,
}: {
  idea: SideGift;
  listId: string;
  listLocale: LocaleCode;
  t: Translate;
}) {
  const ideaBase = `/l/${listId}/ideas/${idea.id}`;
  return (
    <li id={`idea-${idea.id}`} class={`idea-row${idea.mine ? " is-own-idea" : ""}`}>
      <div class="idea-main">
        <div class="item-body">
          <div class="item-title-line">
            <span class="item-name">{idea.name}</span>
            {idea.priceCents !== null && (
              <span class="item-price tabular">{formatMoney(idea.priceCents, listLocale)}</span>
            )}
            <span class={`pill ${idea.mine ? "pill-mint" : "pill-sun"}`}>
              {idea.mine
                ? t("guest.idea_by_you", { name: idea.byName })
                : t("guest.idea_by", { name: idea.byName })}
            </span>
          </div>

          {idea.details && <p class="item-details">{idea.details}</p>}

          {idea.url && (
            <a
              href={idea.url}
              class="item-link"
              target="_blank"
              rel="noopener noreferrer nofollow"
              aria-label={`${t("common.open_link")}: ${idea.name}`}
            >
              <span>{formatHost(idea.url)}</span>
              <ExternalLinkIcon />
            </a>
          )}
        </div>

        {idea.mine && (
          <div class="row-controls">
            <form method="post" action={`${ideaBase}/delete`} class="inline-form">
              <button
                type="submit"
                class="btn-chip btn-danger-subtle"
                aria-label={t("guest.delete_idea", { name: idea.name })}
              >
                {t("common.delete")}
              </button>
            </form>
          </div>
        )}
      </div>

      {idea.mine && (
        <InlineDraftEdit
          action={ideaBase}
          idPrefix={`edit-idea-${idea.id}`}
          draft={idea}
          nameLabel={t("guest.add_idea_label")}
          t={t}
        />
      )}
    </li>
  );
}

export function GuestListView(p: GuestListPage) {
  const { t } = p.chrome;
  return (
    <Layout
      chrome={p.chrome}
      title={t("guest.page_title", { title: p.list.title, owner: p.list.ownerName })}
    >
      {renderGuestFlash(p.flash, t)}

      <header class="list-head">
        <h1>{p.list.title}</h1>
        <div class="list-meta">
          <span class="meta-text">
            {t("guest.context", { owner: p.list.ownerName, guest: p.guestName })}
          </span>
          {p.list.occasionDate && (
            <span class="pill pill-sun">
              {t("guest.occasion_date", {
                date: formatOccasionDate(p.list.occasionDate, p.chrome.locale),
              })}
            </span>
          )}
        </div>
      </header>

      <section class="page-section" aria-labelledby="wishlist-heading">
        <div class="section-head">
          <h2 id="wishlist-heading">{t("guest.wishlist_heading", { owner: p.list.ownerName })}</h2>
          <p class="section-intro">{t("guest.wishlist_hint", { owner: p.list.ownerName })}</p>
        </div>

        {p.items.length === 0 ? (
          <p class="empty-state">{t("guest.empty_items", { owner: p.list.ownerName })}</p>
        ) : (
          <ul class="gift-list">
            {p.items.map((item) => (
              <GuestWishlistRow
                key={item.id}
                item={item}
                listId={p.list.id}
                listLocale={p.list.locale}
                t={t}
              />
            ))}
          </ul>
        )}
      </section>

      <section class="page-section ideas-section" aria-labelledby="ideas-heading">
        <div class="section-head">
          <h2 id="ideas-heading">{t("guest.ideas_heading")}</h2>
          <p class="section-intro">{t("guest.ideas_intro", { owner: p.list.ownerName })}</p>
        </div>

        <DraftAddRow
          action={`/l/${p.list.id}/ideas`}
          idPrefix="guest-add-idea"
          nameLabel={t("guest.add_idea_label")}
          namePlaceholder={t("guest.add_idea_placeholder")}
          submitLabel={t("guest.add_idea_submit")}
          t={t}
        />

        {p.sideGifts.length === 0 ? (
          <p class="empty-state">{t("guest.empty_ideas")}</p>
        ) : (
          <ul class="ideas-list">
            {p.sideGifts.map((idea) => (
              <SideGiftRow
                key={idea.id}
                idea={idea}
                listId={p.list.id}
                listLocale={p.list.locale}
                t={t}
              />
            ))}
          </ul>
        )}
      </section>
    </Layout>
  );
}
