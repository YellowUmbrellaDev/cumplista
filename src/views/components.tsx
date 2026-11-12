import type { ItemDraft } from "../domain/types.js";
import type { LocaleCode, Translate } from "../i18n/index.js";

export function formatMoney(cents: number, listLocale: LocaleCode): string {
  const currency = listLocale === "en" ? "USD" : "EUR";
  return new Intl.NumberFormat(listLocale, { style: "currency", currency }).format(cents / 100);
}

export function formatPriceInput(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toFixed(2);
}

export function formatOccasionDate(isoDate: string, displayLocale: LocaleCode): string {
  const parts = isoDate.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (
    parts.length !== 3 ||
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return isoDate;
  }
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(utcDate.getTime())) return isoDate;
  return new Intl.DateTimeFormat(displayLocale, { dateStyle: "long", timeZone: "UTC" }).format(
    utcDate,
  );
}

export function formatHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return rawUrl;
  }
}

export function CheckIcon() {
  return (
    <svg class="icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M4.5 10.5L8.2 14.2L15.5 6.5"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg class="icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 4.5V15.5M4.5 10H15.5"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
    </svg>
  );
}

export function ChevronUpIcon() {
  return (
    <svg class="icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M5.5 12.2L10 7.7L14.5 12.2"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export function ChevronDownIcon() {
  return (
    <svg class="icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M5.5 7.8L10 12.3L14.5 7.8"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export function ExternalLinkIcon() {
  return (
    <svg class="icon icon-sm" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.5 3.5H3.8C3.08 3.5 2.5 4.08 2.5 4.8V12.2C2.5 12.92 3.08 13.5 3.8 13.5H11.2C11.92 13.5 12.5 12.92 12.5 12.2V9.5M9.5 2.5H13.5M13.5 2.5V6.5M13.5 2.5L7.5 8.5"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

type DraftAddRowProps = {
  action: string;
  idPrefix: string;
  nameLabel: string;
  namePlaceholder: string;
  submitLabel: string;
  t: Translate;
};

export function DraftAddRow({
  action,
  idPrefix,
  nameLabel,
  namePlaceholder,
  submitLabel,
  t,
}: DraftAddRowProps) {
  return (
    <form method="post" action={action} class="draft-add">
      <div class="draft-add-bar">
        <span class="round-marker" aria-hidden="true">
          <PlusIcon />
        </span>
        <label for={`${idPrefix}-name`} class="sr-only">
          {nameLabel}
        </label>
        <input
          id={`${idPrefix}-name`}
          name="name"
          type="text"
          required
          maxlength={120}
          placeholder={namePlaceholder}
          class="draft-name-input"
        />
        <button type="submit" class="btn btn-primary">
          {submitLabel}
        </button>
      </div>
      <details class="draft-more">
        <summary class="draft-more-toggle">{t("field.item_more")}</summary>
        <div class="draft-fields-grid">
          <div class="field-group">
            <label for={`${idPrefix}-price`}>
              <span>{t("field.price_label")}</span>
              <span class="field-optional">{t("common.optional")}</span>
            </label>
            <input
              id={`${idPrefix}-price`}
              name="price"
              type="text"
              inputmode="decimal"
              placeholder={t("field.price_placeholder")}
            />
          </div>
          <div class="field-group">
            <label for={`${idPrefix}-url`}>
              <span>{t("field.url_label")}</span>
              <span class="field-optional">{t("common.optional")}</span>
            </label>
            <input
              id={`${idPrefix}-url`}
              name="url"
              type="url"
              maxlength={2048}
              placeholder={t("field.url_placeholder")}
            />
          </div>
          <div class="field-group field-group-full">
            <label for={`${idPrefix}-details`}>
              <span>{t("field.details_label")}</span>
              <span class="field-optional">{t("common.optional")}</span>
            </label>
            <textarea
              id={`${idPrefix}-details`}
              name="details"
              rows={2}
              maxlength={1000}
              placeholder={t("field.details_placeholder")}
            ></textarea>
          </div>
        </div>
      </details>
    </form>
  );
}

type InlineDraftEditProps = {
  action: string;
  idPrefix: string;
  draft: ItemDraft;
  nameLabel: string;
  t: Translate;
};

export function InlineDraftEdit({
  action,
  idPrefix,
  draft,
  nameLabel,
  t,
}: InlineDraftEditProps) {
  return (
    <details class="inline-edit">
      <summary class="btn-chip">{t("common.edit")}</summary>
      <form method="post" action={action} class="edit-form">
        <div class="draft-fields-grid">
          <div class="field-group field-group-full">
            <label for={`${idPrefix}-name`}>{nameLabel}</label>
            <input
              id={`${idPrefix}-name`}
              name="name"
              type="text"
              required
              maxlength={120}
              value={draft.name}
            />
          </div>
          <div class="field-group">
            <label for={`${idPrefix}-price`}>
              <span>{t("field.price_label")}</span>
              <span class="field-optional">{t("common.optional")}</span>
            </label>
            <input
              id={`${idPrefix}-price`}
              name="price"
              type="text"
              inputmode="decimal"
              value={formatPriceInput(draft.priceCents)}
              placeholder={t("field.price_placeholder")}
            />
          </div>
          <div class="field-group">
            <label for={`${idPrefix}-url`}>
              <span>{t("field.url_label")}</span>
              <span class="field-optional">{t("common.optional")}</span>
            </label>
            <input
              id={`${idPrefix}-url`}
              name="url"
              type="url"
              maxlength={2048}
              value={draft.url ?? ""}
              placeholder={t("field.url_placeholder")}
            />
          </div>
          <div class="field-group field-group-full">
            <label for={`${idPrefix}-details`}>
              <span>{t("field.details_label")}</span>
              <span class="field-optional">{t("common.optional")}</span>
            </label>
            <textarea
              id={`${idPrefix}-details`}
              name="details"
              rows={2}
              maxlength={1000}
              placeholder={t("field.details_placeholder")}
            >
              {draft.details ?? ""}
            </textarea>
          </div>
        </div>
        <div class="edit-actions">
          <button type="submit" class="btn btn-primary">
            {t("common.save")}
          </button>
        </div>
      </form>
    </details>
  );
}
