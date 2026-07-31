import {
  firstText,
  rec,
  records,
  textOrNull,
  type JsonRecord,
} from './lookup-display-shared.ts';

export function buildLookupLifecycleDates(input: {
  availability: JsonRecord;
  rdapParsed: JsonRecord;
  whoisParsed: JsonRecord;
}) {
  const { availability, rdapParsed, whoisParsed } = input;
  const eventDate = (action: string) =>
    textOrNull(records(rdapParsed.events).find((item) => item.action === action)?.date);
  const rdapLifecycle = rec(rdapParsed.lifecycle);
  const whoisLifecycle = rec(whoisParsed.lifecycle);

  return {
    created: firstText(
      availability.createdDateIso,
      availability.createdDate,
      rdapLifecycle.createdDateIso,
      rdapLifecycle.createdDate,
      eventDate('registration'),
      whoisParsed.createdDateIso,
      whoisLifecycle.createdDateIso,
      whoisParsed.createdDate,
    ),
    expires: firstText(
      availability.expiryDateIso,
      availability.expiryDate,
      rdapLifecycle.expiryDateIso,
      rdapLifecycle.expiryDate,
      eventDate('expiration'),
      whoisParsed.expiryDateIso,
      whoisLifecycle.expiryDateIso,
      whoisParsed.expiryDate,
    ),
    updated: firstText(
      rdapLifecycle.updatedDateIso,
      rdapLifecycle.updatedDate,
      eventDate('last changed'),
      whoisParsed.updatedDateIso,
      whoisLifecycle.updatedDateIso,
      whoisParsed.updatedDate,
    ),
  };
}
