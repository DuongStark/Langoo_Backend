import { mapImage } from './image-mapper';
import { ImageCandidate } from './types/image.types';

describe('image-mapper', () => {
  const defaultBase = 'https://media.langoo.org';

  const validCandidate: ImageCandidate = {
    object_key:
      'illustrations/muse-ordinary-auto-v2/4733a53dfde670692dfcffe0518b939011eeaf8e9cd54bb819228181e26a0c65.png',
    mime: 'image/png',
    metadata: {
      width: 512,
      height: 512,
    },
  };

  it('map candidate hợp lệ thành contract URL đầy đủ', () => {
    const result = mapImage(validCandidate, defaultBase);
    expect(result).toEqual({
      url: 'https://media.langoo.org/illustrations/muse-ordinary-auto-v2/4733a53dfde670692dfcffe0518b939011eeaf8e9cd54bb819228181e26a0c65.png',
      mime: 'image/png',
      width: 512,
      height: 512,
    });
  });

  it('normalizes repeated base slashes and rejects encoded traversal', () => {
    expect(
      mapImage(
        { ...validCandidate, object_key: 'a.png' },
        'https://cdn.example.com/assets///',
      )?.url,
    ).toBe('https://cdn.example.com/assets/a.png');
    for (const key of ['%2e%2e/a.png', 'x/%252e%252e/a.png', '%2fetc.png'])
      expect(
        mapImage({ ...validCandidate, object_key: key }, defaultBase),
      ).toBeNull();
  });

  it('trả null khi candidate là null', () => {
    expect(mapImage(null, defaultBase)).toBeNull();
  });

  it('trả null khi MIME không nằm trong allowlist', () => {
    const candidate: ImageCandidate = {
      ...validCandidate,
      mime: 'image/svg+xml',
    };
    expect(mapImage(candidate, defaultBase)).toBeNull();

    expect(
      mapImage({ ...validCandidate, mime: 'application/pdf' }, defaultBase),
    ).toBeNull();
  });

  it('chấp nhận các MIME trong allowlist (png, jpeg, webp, avif)', () => {
    for (const mime of [
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/avif',
    ]) {
      const res = mapImage({ ...validCandidate, mime }, defaultBase);
      expect(res?.mime).toBe(mime);
    }
  });

  it('xử lý base URL có trailing slash và prefix path chuẩn xác', () => {
    const res1 = mapImage(validCandidate, 'https://media.langoo.org/');
    expect(res1?.url).toBe(
      'https://media.langoo.org/illustrations/muse-ordinary-auto-v2/4733a53dfde670692dfcffe0518b939011eeaf8e9cd54bb819228181e26a0c65.png',
    );

    const res2 = mapImage(validCandidate, 'https://cdn.example.com/assets/');
    expect(res2?.url).toBe(
      'https://cdn.example.com/assets/illustrations/muse-ordinary-auto-v2/4733a53dfde670692dfcffe0518b939011eeaf8e9cd54bb819228181e26a0c65.png',
    );
  });

  it('từ chối object_key có traversal hoặc ký tự không an toàn', () => {
    const invalidKeys = [
      '../secret.png',
      'foo/../../bar.png',
      '/leading-slash.png',
      'has\\backslash.png',
      'has spaces.png',
      'http://malicious.com/pic.png',
      '',
      '   ',
    ];
    for (const key of invalidKeys) {
      expect(
        mapImage({ ...validCandidate, object_key: key }, defaultBase),
      ).toBeNull();
    }
  });

  it('parse dimension hợp lệ từ number hoặc string số nguyên 1..16384', () => {
    expect(
      mapImage(
        { ...validCandidate, metadata: { width: 1024, height: '768' } },
        defaultBase,
      ),
    ).toMatchObject({ width: 1024, height: 768 });

    expect(
      mapImage(
        { ...validCandidate, metadata: { width: 1, height: 16384 } },
        defaultBase,
      ),
    ).toMatchObject({ width: 1, height: 16384 });
  });

  it('xử lý metadata thiếu hoặc giá trị lỗi thành null mà không loại bỏ ảnh', () => {
    const testCases = [
      undefined,
      null,
      {},
      { width: 0, height: -10 },
      { width: 16385, height: '999999' },
      { width: 512.5, height: NaN },
      { width: '512px', height: 'auto' },
      { width: {}, height: [] },
    ];

    for (const meta of testCases) {
      const res = mapImage({ ...validCandidate, metadata: meta }, defaultBase);
      expect(res).not.toBeNull();
      expect(res?.url).toBeDefined();
      expect(res?.width).toBeNull();
      expect(res?.height).toBeNull();
    }
  });
});
