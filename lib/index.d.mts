import Schema from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";

//#region src/types.d.ts

interface ProductConfig {
  defaultRoot: string;
  reportDir: string;
  maxFiles: number;
  maxRows: number;
  maxFileBytes: number;
  maxTextChars: number;
  maxResultChars: number;
  defaultLanguage: string;
  defaultTimezone: string;
  maxResearchQueries: number;
  maxResearchResults: number;
  maxResearchChars: number;
  requestTimeoutMs: number;
}
//#endregion
//#region src/index.d.ts
declare const name = "dsh-product";
declare const inject: string[];
type Config = ProductConfig;
declare const Config: Schema<ProductConfig>;
declare function apply(ctx: Context, config: ProductConfig): void;
//#endregion
export { Config, apply, inject, name };