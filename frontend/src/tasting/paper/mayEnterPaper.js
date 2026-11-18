/** The one UI mirror of the server's paper-entry gate: Advanced cuppings, host or editor/admin. */
export const mayEnterPaper = (flight, { canManage }) =>
  flight.sheet === 'advanced' && (!!canManage || !!flight.is_host);
