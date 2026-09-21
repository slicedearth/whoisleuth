import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { requireJsonRecord as record, boundedUnpaddedText as boundedString } from './maintainer-tool-helpers.mts';
import type { RunInstalledCli } from './installed-cli-check.mts';
import { CLI_COMMANDS } from '../cli/command-reference.mts';

/** Installed discovery, help and planning checks; no collection is performed. */
export async function checkInstalledCliDiscovery(temporaryRoot: string, packageVersion: string, run: RunInstalledCli): Promise<void> {
  const help = await run(['--help'], 'help');
  if (!help.startsWith('WHOISleuth CLI\n')
    || !help.includes('Fast lookup is the default; deep collection')
    || !help.includes('eligible interactive terminal opens a bounded launcher')) {
    throw new TypeError('Installed CLI help contract failed.');
  }
  const zeroArgumentHelp = await run([], 'zero-argument redirected help');
  if (zeroArgumentHelp !== help) throw new TypeError('Installed CLI zero-argument redirected invocation did not preserve static help.');
  const shortHelp = await run(['-h'], 'short help');
  if (shortHelp !== help) throw new TypeError('Installed CLI short help alias did not preserve static help.');
  const version = await run(['--version'], 'version');
  if (version !== `${packageVersion}\n`) throw new TypeError('Installed CLI version does not match the generated package manifest.');
  const shortVersion = await run(['-V'], 'short version');
  if (shortVersion !== version) throw new TypeError('Installed CLI short version alias did not preserve the package version.');
  const doctor = await run(['doctor', '--json'], 'doctor');
  const doctorDocument = record(JSON.parse(doctor), 'Installed doctor output');
  if (doctorDocument.schema !== 'whoisleuth.cli.doctor' || doctorDocument.networkRequested !== false) {
    throw new TypeError('Installed offline doctor command returned the wrong contract.');
  }
  const commands = await run(['commands', '--json'], 'commands');
  const commandCatalogue = record(JSON.parse(commands), 'Installed command catalogue');
  if (commandCatalogue.schema !== 'whoisleuth.cli.command-catalogue'
    || commandCatalogue.version !== 1
    || !Array.isArray(commandCatalogue.commands)
    || Object.keys(commandCatalogue).sort().join(',') !== 'commands,packageVersion,schema,version') {
    throw new TypeError('Installed command catalogue returned the wrong contract.');
  }
  const lookupPlan = await run(['lookup', 'example.test', '--deep', '--plan', '--json'], 'lookup plan');
  const lookupPlanDocument = record(JSON.parse(lookupPlan), 'Installed Lookup plan');
  if (lookupPlanDocument.schema !== 'whoisleuth.cli.lookup-plan'
    || record(lookupPlanDocument.planning, 'Installed Lookup plan collection').networkRequestsMade !== false) {
    throw new TypeError('Installed offline Lookup plan returned the wrong contract.');
  }
  const directLookupPlan = await run(['example.test', '--deep', '--plan', '--json'], 'direct Lookup plan');
  const directLookupPlanDocument = record(JSON.parse(directLookupPlan), 'Installed direct Lookup plan');
  if (directLookupPlanDocument.schema !== 'whoisleuth.cli.lookup-plan'
    || record(directLookupPlanDocument.planning, 'Installed direct Lookup plan collection').networkRequestsMade !== false
    || record(directLookupPlanDocument.target, 'Installed direct Lookup target').query !== record(lookupPlanDocument.target, 'Installed Lookup target').query
    || directLookupPlanDocument.mode !== lookupPlanDocument.mode) {
    throw new TypeError('Installed direct target did not preserve the offline Lookup plan contract.');
  }
  const selectedUrlPlan = await run(['lookup', 'https://portal.example.test/review?item=private-example#local-fragment',
    '--deep', '--exact-url', '--plan', '--json'], 'selected URL plan');
  const selectedUrlPlanDocument = record(JSON.parse(selectedUrlPlan), 'Installed selected URL plan');
  if (selectedUrlPlanDocument.schema !== 'whoisleuth.cli.lookup-plan'
    || record(selectedUrlPlanDocument.target, 'Installed selected URL target').query !== 'portal.example.test'
    || record(selectedUrlPlanDocument.planning, 'Installed selected URL planning').networkRequestsMade !== false
    || !selectedUrlPlan.includes('selected URL path and query')
    || /private-example|local-fragment|\/review/u.test(selectedUrlPlan)) {
    throw new TypeError('Installed selected URL plan did not preserve its offline disclosure boundary.');
  }
  const completionChecks = [
    ['bash', '-F _whoisleuth_completion whoisleuth', '--palette', '--save-lookup'],
    ['zsh', '#compdef whoisleuth', '--palette', '--save-lookup'],
    ['fish', 'complete -c whoisleuth', '-l palette', '-l save-lookup'],
    ['powershell', 'Register-ArgumentCompleter -Native -CommandName whoisleuth', '--palette', '--save-lookup'],
  ] as const;
  for (const [shell, marker, paletteMarker, saveLookupMarker] of completionChecks) {
    const completion = await run(['completion', shell], `${shell} completion`);
    if (!completion.includes(marker) || !completion.includes(paletteMarker) || !completion.includes(saveLookupMarker)) {
      throw new TypeError(`Installed ${shell} completion command returned the wrong script.`);
    }
  }
  const manual = await run(['manual'], 'manual');
  if (!manual.startsWith('.TH WHOISLEUTH 1')
    || !manual.includes('.SS diff')
    || !manual.includes('\\-\\-save\\-lookup')
    || !manual.includes('--palette')) {
    throw new TypeError('Installed CLI manual command returned the wrong document.');
  }
  const registrySupport = await run(['registry-support', 'example.test', '--json'], 'registry-support');
  const registryDocument = record(JSON.parse(registrySupport), 'Installed registry-support output');
  if (registryDocument.schema !== 'whoisleuth.cli.registry-support') throw new TypeError('Installed offline registry-support command returned the wrong schema.');
  const discovery = await run([
    'discover',
    'example.test',
    '--families',
    'character_omission',
    '--tlds',
    'test',
    '--json',
  ], 'discover');
  const discoveryDocument = record(JSON.parse(discovery), 'Installed discover output');
  if (discoveryDocument.schema !== 'whoisleuth.cli.discover') throw new TypeError('Installed offline discover command returned the wrong schema.');
  if (!Array.isArray(discoveryDocument.candidates) || discoveryDocument.candidates.length === 0) {
    throw new TypeError('Installed offline discover command returned no candidates.');
  }
  const discoveryScanHelp = await run(['discover-scan', '--help'], 'discover-scan help');
  if (!discoveryScanHelp.includes('whoisleuth discover-scan') || !discoveryScanHelp.includes('This command performs network collection.')) {
    throw new TypeError('Installed discover-scan help did not preserve its explicit network boundary.');
  }
  const mailHeaderFixture = path.join(temporaryRoot, 'message.eml');
  await writeFile(mailHeaderFixture, [
    'Authentication-Results: mx.example.test; spf=pass; dkim=pass; dmarc=pass',
    'From: private-person@example.test',
    'Subject: private subject',
    '',
    'private body',
  ].join('\r\n'), { encoding: 'utf8', mode: 0o600 });
  const mailHeaderReview = record(JSON.parse(await run(
    ['mail-headers', mailHeaderFixture, '--json'],
    'mail-header review',
  )), 'Installed mail-header review');
  const mailHeaderProvenance = record(mailHeaderReview.provenance, 'Installed mail-header provenance');
  if (mailHeaderReview.schema !== 'whoisleuth.cli.mail-header-review'
    || mailHeaderProvenance.bodyRetained !== false
    || mailHeaderProvenance.attachmentsRetained !== false
    || mailHeaderProvenance.localPartsRetained !== false
    || JSON.stringify(mailHeaderReview).includes('private-person')
    || JSON.stringify(mailHeaderReview).includes('private subject')
    || JSON.stringify(mailHeaderReview).includes('private body')) {
    throw new TypeError('Installed offline mail-header review did not preserve its privacy boundary.');
  }
  const catalogueCommands = commandCatalogue.commands.map((entry, index) => boundedString(
    record(entry, `Installed command catalogue entry ${index + 1}`).command,
    `Installed command catalogue entry ${index + 1} command`,
    80,
  ));
  if (catalogueCommands.length !== CLI_COMMANDS.length
    || catalogueCommands.some((command, index) => command !== CLI_COMMANDS[index])) {
    throw new TypeError('Installed command catalogue must match the canonical command registry and order.');
  }
  for (const [index, entry] of commandCatalogue.commands.entries()) {
    if (Object.keys(record(entry, `Installed command catalogue entry ${index + 1}`)).sort().join(',')
      !== 'boundary,collection,command,description,example,usage') {
      throw new TypeError(`Installed command catalogue entry ${index + 1} has an unsupported shape.`);
    }
  }
  for (const command of catalogueCommands) {
    const commandHelp = await run([command, '--help'], `${command} help`);
    if (!commandHelp.includes(`whoisleuth ${command}`)) {
      throw new TypeError(`Installed ${command} help did not preserve its command contract.`);
    }
  }
}
