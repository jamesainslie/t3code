/**
 * Fork-only. Imported first by the main process, so pre-rename environment
 * variables are moved to their Lathe names before any module reads one.
 */
import { adoptLegacyProcessEnv } from "@lathe/shared/forkLegacyEnv";

adoptLegacyProcessEnv();
