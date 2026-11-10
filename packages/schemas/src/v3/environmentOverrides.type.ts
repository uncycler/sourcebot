// THIS IS A AUTO-GENERATED FILE. DO NOT MODIFY MANUALLY!

/**
 * Environment variable overrides.
 */
export interface EnvironmentOverrides {
  /**
   * This interface was referenced by `EnvironmentOverrides`'s JSON-Schema definition
   * via the `patternProperty` "^[a-zA-Z0-9_-]+$".
   */
  [k: string]:
    | {
        type: "token";
        value: Token;
      }
    | {
        type: "string";
        value: string;
      }
    | {
        type: "number";
        value: number;
      }
    | {
        type: "boolean";
        value: boolean;
      };
}
export interface Token {
  /**
   * The name of the environment variable that contains the token.
   */
  env: string;
}
