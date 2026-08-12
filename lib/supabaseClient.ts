// Offline stub — this build has no Supabase backend.
//
// Upstream RustySEO shipped a community chat room and a "send a suggestion"
// form, both backed by a third-party Supabase project. Between them they sent
// your chosen nickname, every message you typed, your online/offline presence,
// an anonymous-auth account tied to your device, and any feedback text off the
// machine. None of that belongs in a personal build, so the real client is
// replaced by an inert one: reads resolve empty, writes resolve with an error,
// realtime channels never connect. No socket is ever opened.
//
// The shape below mirrors only the parts of supabase-js the app actually
// touched, so callers keep their normal `{ data, error }` handling paths.

const DISABLED_ERROR = {
  message: "Networked features are disabled in this build.",
  code: "OFFLINE",
  details: null,
  hint: null,
};

type Result = { data: any; error: any };

// Chainable query builder. Every filter/modifier returns `this`, and awaiting
// the builder resolves to an empty successful read (or a failed write).
class QueryStub implements PromiseLike<Result> {
  private isWrite = false;
  private wantsSingle = false;

  select() {
    return this;
  }
  insert() {
    this.isWrite = true;
    return this;
  }
  update() {
    this.isWrite = true;
    return this;
  }
  upsert() {
    this.isWrite = true;
    return this;
  }
  delete() {
    this.isWrite = true;
    return this;
  }
  eq() {
    return this;
  }
  neq() {
    return this;
  }
  or() {
    return this;
  }
  in() {
    return this;
  }
  gt() {
    return this;
  }
  lt() {
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  range() {
    return this;
  }
  single() {
    this.wantsSingle = true;
    return this;
  }
  maybeSingle() {
    this.wantsSingle = true;
    return this;
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const result: Result = this.isWrite
      ? { data: null, error: DISABLED_ERROR }
      : { data: this.wantsSingle ? null : [], error: null };
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

// Realtime channel that never subscribes to anything.
const channelStub = () => {
  const channel: any = {
    on: () => channel,
    subscribe: (cb?: (status: string) => void) => {
      // Report a terminal, non-connected status so callers stop waiting
      // instead of hanging on a "SUBSCRIBED" that will never arrive.
      if (typeof cb === "function") cb("CHANNEL_ERROR");
      return channel;
    },
    track: async () => ({ error: DISABLED_ERROR }),
    untrack: async () => ({ error: DISABLED_ERROR }),
    presenceState: () => ({}),
    unsubscribe: async () => "ok",
  };
  return channel;
};

export const supabase: any = {
  from: () => new QueryStub(),
  channel: channelStub,
  removeChannel: () => {},
  removeAllChannels: () => {},
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
    signInAnonymously: async () => ({
      data: { user: null, session: null },
      error: DISABLED_ERROR,
    }),
    signOut: async () => ({ error: null }),
    onAuthStateChange: () => ({
      data: { subscription: { unsubscribe: () => {} } },
    }),
  },
};
