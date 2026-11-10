/** Sample pastes for the XID wraparound calculator. */
export const SAMPLE_XID = `  datname   |  xid_age   | mxid_age
------------+------------+-----------
 orders     | 1702334511 |  12000034
 analytics  |  412938112 | 450123004
 reporting  | 1150022871 |  81000300
 postgres   |  180223001 |   3002111
 template1  |  180222990 |   3002100
 template0  |  180222990 |   3002100
(6 rows)
`;

export const SAMPLE_MXID = `relname,xid_age,mxid_age,size
public.order_items,1702334511,1620004400,412 GB
public.inventory_locks,402331871,905112003,18 GB
public.customers,212330004,402000117,61 GB
public.audit_log,150004112,9001223,1210 GB
pg_toast.pg_toast_16481,98123441,1200,3 GB
`;

export const SAMPLE_STATE = {
  tab: "xid",
  version: "pg14",
  xid: { text: SAMPLE_XID, freeze: "200000000", failsafe: "1600000000", rate: "25M" },
  mxid: { text: SAMPLE_MXID, freeze: "400000000", failsafe: "1600000000", rate: "4M" },
};

export const EMPTY_STATE = {
  tab: "xid",
  version: "pg14",
  xid: { text: "", freeze: "200000000", failsafe: "1600000000", rate: "" },
  mxid: { text: "", freeze: "400000000", failsafe: "1600000000", rate: "" },
};
