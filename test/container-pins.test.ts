import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The same files container/build.sh reads, so a pin that moves to a new
// download host fails here before anyone builds the image.
const read = (name: string) => readFileSync(new URL(`../container/${name}`, import.meta.url), 'utf8');

// Lines that aren't blank or comments, as build.sh skips them.
const entries = (text: string) => text.split('\n').filter((line) => line !== '' && !line.startsWith('#'));

const hosts = entries(read('download-hosts.txt'));

const urlPins = entries(read('pins.env'))
  .map((line) => {
    const at = line.indexOf('=');
    return { key: line.slice(0, at), value: line.slice(at + 1) };
  })
  .filter(({ key }) => key.endsWith('_URL'));

// build.sh's valid() shape for a URL pin: https and no user, port or space.
const urlShape = /^https:\/\/[A-Za-z0-9./_+-]+$/;

// build.sh's own rule: after https://, everything up to the first slash.
function hostOf(url: string) {
  const rest = url.slice('https://'.length);
  const slash = rest.indexOf('/');
  return slash === -1 ? rest : rest.slice(0, slash);
}

describe('the container download hosts', () => {
  it('are each listed once, in lower case', () => {
    expect(
      hosts.filter((host) => !/^[a-z0-9.-]+$/.test(host)),
      'malformed hosts in download-hosts.txt',
    ).toEqual([]);
    expect(new Set(hosts).size, 'download-hosts.txt lists a host twice').toBe(hosts.length);
  });

  it('cover every URL pin', () => {
    expect(urlPins.length, 'pins.env has no *_URL pins to check').toBeGreaterThan(0);
    const outside = urlPins
      .filter(({ value }) => !urlShape.test(value) || !hosts.includes(hostOf(value)))
      .map(({ key, value }) =>
        urlShape.test(value) ? `${key} downloads from ${hostOf(value)}` : `${key} is malformed`,
      );
    expect(outside, 'pins.env has URL pins that are malformed or on hosts not in container/download-hosts.txt').toEqual(
      [],
    );
  });

  it('are all still used by a pin', () => {
    const used = new Set(urlPins.map(({ value }) => hostOf(value)));
    expect(
      hosts.filter((host) => !used.has(host)),
      'download-hosts.txt lists hosts no pin uses',
    ).toEqual([]);
  });
});
