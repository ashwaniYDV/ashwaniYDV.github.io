/**
 * Sample query and a matching EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)
 * plan for the index advisor. Hand-built, made-up shop schema.
 */
export const SAMPLE_QUERY = `-- Latest pending orders in a region, with the customer's name
SELECT o.id, o.created_at, o.total, c.name
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.region_id = 7
  AND o.status = 'pending'
  AND o.created_at >= now() - interval '30 days'
  AND EXISTS (
    SELECT 1 FROM line_items l
    WHERE l.order_id = o.id
      AND l.deleted_at IS NULL
  )
ORDER BY o.created_at DESC
LIMIT 50;`;

const plan = [
  {
    Plan: {
      "Node Type": "Limit",
      "Startup Cost": 152031.4,
      "Total Cost": 152031.53,
      "Plan Rows": 50,
      "Plan Width": 52,
      "Actual Startup Time": 5212.4,
      "Actual Total Time": 5212.46,
      "Actual Rows": 50,
      "Actual Loops": 1,
      Output: ["o.id", "o.created_at", "o.total", "c.name"],
      Plans: [
        {
          "Node Type": "Sort",
          "Parent Relationship": "Outer",
          "Startup Cost": 152031.4,
          "Total Cost": 152034.1,
          "Plan Rows": 1080,
          "Plan Width": 52,
          "Actual Startup Time": 5212.4,
          "Actual Total Time": 5212.43,
          "Actual Rows": 50,
          "Actual Loops": 1,
          Output: ["o.id", "o.created_at", "o.total", "c.name"],
          "Sort Key": ["o.created_at DESC"],
          "Sort Method": "top-N heapsort",
          "Sort Space Used": 32,
          "Sort Space Type": "Memory",
          Plans: [
            {
              "Node Type": "Nested Loop",
              "Parent Relationship": "Outer",
              "Join Type": "Semi",
              "Startup Cost": 0.43,
              "Total Cost": 151995.6,
              "Plan Rows": 1080,
              "Plan Width": 52,
              "Actual Startup Time": 3.2,
              "Actual Total Time": 5211.1,
              "Actual Rows": 1130,
              "Actual Loops": 1,
              Output: ["o.id", "o.created_at", "o.total", "c.name"],
              "Inner Unique": false,
              Plans: [
                {
                  "Node Type": "Nested Loop",
                  "Parent Relationship": "Outer",
                  "Join Type": "Inner",
                  "Startup Cost": 0.43,
                  "Total Cost": 48210.2,
                  "Plan Rows": 1180,
                  "Plan Width": 60,
                  "Actual Startup Time": 2.9,
                  "Actual Total Time": 431.2,
                  "Actual Rows": 1200,
                  "Actual Loops": 1,
                  Output: ["o.id", "o.created_at", "o.total", "c.name"],
                  "Inner Unique": true,
                  Plans: [
                    {
                      "Node Type": "Seq Scan",
                      "Parent Relationship": "Outer",
                      "Relation Name": "orders",
                      Schema: "public",
                      Alias: "o",
                      "Startup Cost": 0.0,
                      "Total Cost": 46890.0,
                      "Plan Rows": 1180,
                      "Plan Width": 32,
                      "Actual Startup Time": 2.7,
                      "Actual Total Time": 418.6,
                      "Actual Rows": 1200,
                      "Actual Loops": 1,
                      Output: ["o.id", "o.created_at", "o.total", "o.customer_id"],
                      Filter:
                        "((o.region_id = 7) AND (o.status = 'pending'::text) AND (o.created_at >= (now() - '30 days'::interval)))",
                      "Rows Removed by Filter": 1998800,
                      "Shared Hit Blocks": 4210,
                      "Shared Read Blocks": 22680,
                    },
                    {
                      "Node Type": "Index Scan",
                      "Parent Relationship": "Inner",
                      "Scan Direction": "Forward",
                      "Index Name": "customers_pkey",
                      "Relation Name": "customers",
                      Schema: "public",
                      Alias: "c",
                      "Startup Cost": 0.29,
                      "Total Cost": 1.1,
                      "Plan Rows": 1,
                      "Plan Width": 36,
                      "Actual Startup Time": 0.009,
                      "Actual Total Time": 0.009,
                      "Actual Rows": 1,
                      "Actual Loops": 1200,
                      Output: ["c.id", "c.name"],
                      "Index Cond": "(c.id = o.customer_id)",
                      "Rows Removed by Index Recheck": 0,
                      "Shared Hit Blocks": 3600,
                      "Shared Read Blocks": 0,
                    },
                  ],
                },
                {
                  "Node Type": "Seq Scan",
                  "Parent Relationship": "Inner",
                  "Relation Name": "line_items",
                  Schema: "public",
                  Alias: "l",
                  "Startup Cost": 0.0,
                  "Total Cost": 1180.0,
                  "Plan Rows": 3,
                  "Plan Width": 8,
                  "Actual Startup Time": 0.6,
                  "Actual Total Time": 3.98,
                  "Actual Rows": 1,
                  "Actual Loops": 1200,
                  Output: ["l.order_id"],
                  Filter: "((l.deleted_at IS NULL) AND (l.order_id = o.id))",
                  "Rows Removed by Filter": 26400,
                  "Shared Hit Blocks": 541200,
                  "Shared Read Blocks": 0,
                },
              ],
            },
          ],
        },
      ],
    },
    Planning: { "Shared Hit Blocks": 12, "Shared Read Blocks": 0 },
    "Planning Time": 0.41,
    Triggers: [],
    "Execution Time": 5212.6,
  },
];

export const SAMPLE_PLAN = JSON.stringify(plan, null, 2);
