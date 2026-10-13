/**
 * Human-facing `/skill-model` command: hands a complex task to the model and
 * asks it to run the skill-market retrieval flow before doing the work.
 *
 * The handler validates the task text, records it as a `skill-model/run`
 * session event, and wakes the model with the task wrapped in
 * `<skill-model-task>` tags. The market tools the flow uses
 * (`market_search` / `market_detail` / `market_file` / `market_install`) ship
 * in the sibling `tool-market` package; this package only triggers the flow.
 *
 * @module bobo-skill-model-tool
 */
import type { Context } from '@deepseek-ai/cordis';
/** Cordis plugin name. */
export declare const name = "command-skill-model";
/** Services required before the command is contributed. */
export declare const inject: string[];
declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        /**
         * A `/skill-model` invocation submitted a complex task. Log-only (never
         * model surface): the payload is the trimmed task text, and the model
         * receives the same text through the follow-up user message. The command
         * sets `recordInput: false` so this event, not `command/run`, owns the
         * task payload.
         */
        'skill-model/run': {
            task: string;
        };
    }
}
/**
 * Register `/skill-model` for every composed human-command adapter. The
 * registration rides `ctx.effect`, so fiber teardown unregisters the command.
 * @param ctx - context carrying the command registry.
 */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map