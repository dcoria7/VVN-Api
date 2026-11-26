import { describe, expect, it } from "vitest";
import { parseDeploymentEnvironment, validateSupabaseEnvironment } from "./deployment-environment";

const staging = "msfrkqfvdhyjnktwuhzd";
const production = "abcdefghijklmnopqrst";
describe("separación de staging y production", () => {
  it.each([undefined, "", "preview", "development"])("exige ambiente explícito: %s", value => {
    expect(() => parseDeploymentEnvironment(value)).toThrow("VVN_ENVIRONMENT");
  });
  it("acepta únicamente los dos ambientes del producto", () => {
    expect(parseDeploymentEnvironment("staging")).toBe("staging");
    expect(parseDeploymentEnvironment("production")).toBe("production");
  });
  it("staging remoto exige el proyecto de pruebas conocido", () => {
    expect(() => validateSupabaseEnvironment("staging", `https://${staging}.supabase.co`, staging)).not.toThrow();
    expect(() => validateSupabaseEnvironment("staging", `https://${production}.supabase.co`, production)).toThrow("ambiente");
  });
  it("production exige otro proyecto explícito", () => {
    expect(() => validateSupabaseEnvironment("production", `https://${production}.supabase.co`, production)).not.toThrow();
    expect(() => validateSupabaseEnvironment("production", `https://${staging}.supabase.co`, staging)).toThrow("ambiente");
    expect(() => validateSupabaseEnvironment("production", `https://${production}.supabase.co`, undefined)).toThrow("PROJECT_REF");
  });
  it("solo staging permite la simulación local", () => {
    expect(() => validateSupabaseEnvironment("staging", "http://127.0.0.1:54321", undefined)).not.toThrow();
    expect(() => validateSupabaseEnvironment("production", "http://127.0.0.1:54321", production)).toThrow();
  });
  it.each([`http://${staging}.supabase.co`, `https://${production}.supabase.co`, `https://${staging}.supabase.co/path`, `https://${staging}.supabase.co?x=1`, `https://user:secret@${staging}.supabase.co`])("rechaza un destino mezclado o ambiguo", url => {
    expect(() => validateSupabaseEnvironment("staging", url, staging)).toThrow();
  });
});
