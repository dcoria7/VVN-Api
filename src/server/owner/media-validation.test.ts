import { describe, expect, it } from 'vitest';
import { deploymentBrandId } from '@/lib/deployment-brand';
import { OwnerValidationError, validateSave } from './validation';

const venue = '00000001-1111-4111-8111-111111111111';
const item = '00000002-1111-4111-8111-111111111111';
const base = 'https://example.invalid';
const media = (ext: string, bucket = 'venue-media', owner = venue, brand = deploymentBrandId) =>
  `${base}/storage/v1/object/public/${bucket}/${brand}/owners/${owner}/${item}.${ext}`;
const save = (section: string, values: Record<string, unknown>) => validateSave({ section, values, revision: 0 }, venue, base);

describe('tipo y pertenencia de archivos del propietario', () => {
  it('permite solo imágenes WebP de la misma marca y negocio', () => {
    expect(save('branding', { logo_url: media('webp') }).values).toEqual({ logo_url: media('webp') });
    for (const url of [media('pdf'), media('webp', 'venue-media', item), media('webp', 'venue-media', venue, item), 'https://example.invalid/external.webp']) {
      expect(() => save('branding', { logo_url: url })).toThrow(OwnerValidationError);
    }
  });
  it('exige PDF en venue-catalogs y rechaza imágenes o el bucket equivocado', () => {
    const pdf = media('pdf', 'venue-catalogs');
    expect(save('catalog', { catalog_pdf_url: pdf }).values).toEqual({ catalog_pdf_url: pdf });
    expect(() => save('catalog', { catalog_pdf_url: media('webp') })).toThrow(OwnerValidationError);
    expect(() => save('catalog', { catalog_pdf_url: media('pdf') })).toThrow(OwnerValidationError);
  });
  it('rechaza secciones heredadas del prototipo', () => {
    expect(() => save('toString', { name: 'Local' })).toThrow(OwnerValidationError);
  });
});
