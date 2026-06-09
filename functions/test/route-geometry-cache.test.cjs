const assert = require('node:assert/strict');
const test = require('node:test');

const { __routeGeometryTestHooks } = require('../lib/transport/route-geometry.js');

const { cacheIdentityForRequest, cleanStops, decodePolyline, encodePolyline } = __routeGeometryTestHooks;

const baseRequest = {
  carrier: 'pks',
  line: '108',
  direction: 'Rzeszow D.A.',
  variant: 'course-a',
  dataVersion: 'road-v3',
  mode: 'road',
};

const stopsToRzeszow = [
  { id: 11, name: 'Gwoznica Gorna', lat: 49.878123, lon: 21.931123, sequence: 0 },
  { id: 12, name: 'Niebylec', lat: 49.856456, lon: 21.904456, sequence: 1 },
  { id: 13, name: 'Rzeszow D.A.', lat: 50.041789, lon: 22.004789, sequence: 2 },
];

test('route cache key ignores concrete trip variant for the same stop geometry', () => {
  const stops = cleanStops(stopsToRzeszow);
  const first = cacheIdentityForRequest({ ...baseRequest, variant: 'course-a', stops }, stops);
  const second = cacheIdentityForRequest({ ...baseRequest, variant: 'course-b', stops }, stops);

  assert.equal(first.canonicalKey, second.canonicalKey);
  assert.equal(first.firestoreDocId, second.firestoreDocId);
});

test('reverse direction uses the same canonical cache document and flips geometry', () => {
  const forwardStops = cleanStops(stopsToRzeszow);
  const reverseStops = cleanStops([...stopsToRzeszow].reverse().map((stop, index) => ({ ...stop, sequence: index })));
  const forward = cacheIdentityForRequest({ ...baseRequest, stops: forwardStops }, forwardStops);
  const reverse = cacheIdentityForRequest({ ...baseRequest, direction: 'Gwoznica Gorna', stops: reverseStops }, reverseStops);

  assert.equal(forward.canonicalKey, reverse.canonicalKey);
  assert.equal(forward.firestoreDocId, reverse.firestoreDocId);
  assert.notEqual(forward.shouldReverseStoredGeometry, reverse.shouldReverseStoredGeometry);
});

test('different relation creates a different canonical cache key', () => {
  const sanokStops = cleanStops(stopsToRzeszow);
  const jasloStops = cleanStops([
    { id: 21, name: 'Rzeszow D.A.', lat: 50.041789, lon: 22.004789, sequence: 0 },
    { id: 22, name: 'Strzyzow', lat: 49.870111, lon: 21.794111, sequence: 1 },
    { id: 23, name: 'Jaslo', lat: 49.744222, lon: 21.472222, sequence: 2 },
  ]);
  const sanok = cacheIdentityForRequest({ ...baseRequest, line: 'Marcel', direction: 'Sanok', stops: sanokStops }, sanokStops);
  const jaslo = cacheIdentityForRequest({ ...baseRequest, line: 'Marcel', direction: 'Jaslo', stops: jasloStops }, jasloStops);

  assert.notEqual(sanok.canonicalKey, jaslo.canonicalKey);
});

test('encoded polyline roundtrips route points', () => {
  const points = stopsToRzeszow.map(({ lat, lon }) => [lat, lon]);
  const decoded = decodePolyline(encodePolyline(points));

  assert.equal(decoded.length, points.length);
  decoded.forEach((point, index) => {
    assert.ok(Math.abs(point[0] - points[index][0]) < 0.00001);
    assert.ok(Math.abs(point[1] - points[index][1]) < 0.00001);
  });
});
