// routes/values.js
const express = require("express");
const router = express.Router();
const pool = require("../utils/DB");
const { processItem } = require("../utils/processItem");

router.get("/", async (req, res) => {
  const {
    page = 1,
    limit = 20,
    brands,
    categories,
    scheduledDates,
    aucNums,
    search,
    ranks,
    withDetails = "false",
    sortBy = "scheduled_date", // 정렬 기준 필드 (기본값: 제목)
    sortOrder = "asc", // 정렬 방향 (기본값: 오름차순)
  } = req.query;
  const offset = (page - 1) * limit;

  try {
    let query = "SELECT * FROM values_items";
    const queryParams = [];
    let conditions = [];

    if (search && search.trim()) {
      const searchTerms = search.trim().split(/\s+/);
      const searchConditions = searchTerms.map(() => "title LIKE ?");
      conditions.push(`(${searchConditions.join(" AND ")})`);
      searchTerms.forEach((term) => {
        queryParams.push(`%${term}%`);
      });
    }

    // 랭크 필터 처리 - LIKE 문 제거하고 직접 비교로 변경
    if (ranks) {
      const rankList = ranks.split(",");
      if (rankList.length > 0) {
        const rankConditions = rankList.map((rank) => {
          switch (rank) {
            case "N":
              return "rank = 'N'";
            case "S":
              return "rank = 'S'";
            case "AB":
              return "rank = 'AB'";
            case "A":
              return "rank = 'A'";
            case "BC":
              return "rank = 'BC'";
            case "B":
              return "rank = 'B'";
            case "C":
              return "rank = 'C'";
            case "D":
              return "rank = 'D'";
            case "E":
              return "rank = 'E'";
            case "F":
              return "rank = 'F'";
            default:
              return `rank = '${rank}'`;
          }
        });
        conditions.push(`(${rankConditions.join(" OR ")})`);
      }
    }

    if (brands) {
      const brandList = brands.split(",");
      if (brandList.length > 0) {
        conditions.push(
          "brand IN (" + brandList.map(() => "?").join(",") + ")"
        );
        queryParams.push(...brandList);
      }
    }

    if (categories) {
      const categoryList = categories.split(",");
      if (categoryList.length > 0) {
        conditions.push(
          "category IN (" + categoryList.map(() => "?").join(",") + ")"
        );
        queryParams.push(...categoryList);
      }
    }

    if (scheduledDates) {
      const dateList = scheduledDates.split(",");
      if (dateList.length > 0) {
        const dateConds = [];
        dateList.forEach((date) => {
          const match = date.match(/(\d{4}-\d{2}-\d{2})/);
          if (match) {
            dateConds.push("(scheduled_date >= ? AND scheduled_date < ?)");
            const startDate = new Date(match[0]);
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + 1);
            queryParams.push(startDate, endDate);
          }
        });
        if (dateConds.length > 0) {
          conditions.push(`(${dateConds.join(" OR ")})`);
        }
      }
    }

    if (aucNums) {
      const aucNumList = aucNums.split(",");
      if (aucNumList.length > 0) {
        conditions.push(`auc_num IN (${aucNumList.map(() => "?").join(",")})`);
        queryParams.push(...aucNumList);
      }
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    const countQuery = `SELECT COUNT(*) as total FROM (${query}) as subquery`;

    // 정렬 처리
    let orderByClause = "";
    switch (sortBy) {
      case "title":
        orderByClause = "title";
        break;
      case "rank":
        orderByClause = "rank";
        break;
      case "scheduled_date":
        orderByClause = "scheduled_date";
        break;
      case "starting_price":
        orderByClause = "ci.starting_price + 0";
        break;
      default:
        orderByClause = "title";
    }

    // 정렬 방향 설정
    const sortDirection = sortOrder.toLowerCase() === "desc" ? "DESC" : "ASC";
    query += ` ORDER BY ${orderByClause} ${sortDirection}`;

    if (orderByClause !== "item_id") {
      query += ", item_id DESC"; // 보조 정렬 기준으로 item_id 추가
    }

    query += " LIMIT ? OFFSET ?";
    queryParams.push(parseInt(limit), offset);

    const [items] = await pool.query(query, queryParams);
    const [countResult] = await pool.query(
      countQuery,
      queryParams.slice(0, -2)
    );
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    if (withDetails === "true") {
      const processPromises = items.map((item) =>
        processItem(item.item_id, true, null, true)
      );
      const detailedItems = await Promise.all(processPromises);

      res.json({
        data: detailedItems.filter((item) => item !== null),
        page: parseInt(page),
        limit: parseInt(limit),
        totalItems,
        totalPages,
      });
    } else {
      res.json({
        data: items,
        page: parseInt(page),
        limit: parseInt(limit),
        totalItems,
        totalPages,
      });
    }
  } catch (error) {
    console.error("Error fetching data from database:", error);
    res.status(500).json({ message: "Error fetching data" });
  }
});

router.get("/brands-with-count", async (req, res) => {
  try {
    const [results] = await pool.query(`
      SELECT brand, COUNT(*) as count
      FROM values_items
      GROUP BY brand
      ORDER BY count DESC, brand ASC
    `);

    res.json(results);
  } catch (error) {
    console.error("Error fetching brands with count:", error);
    res.status(500).json({ message: "Error fetching brands with count" });
  }
});

router.get("/scheduled-dates-with-count", async (req, res) => {
  try {
    const [results] = await pool.query(`
      SELECT DATE(scheduled_date) as Date, COUNT(*) as count
      FROM values_items
      GROUP BY DATE(scheduled_date)
      ORDER BY Date ASC
    `);

    res.json(results);
  } catch (error) {
    console.error("Error fetching scheduled dates with count:", error);
    res
      .status(500)
      .json({ message: "Error fetching scheduled dates with count" });
  }
});

router.get("/brands", async (req, res) => {
  try {
    const [results] = await pool.query(`
      SELECT DISTINCT brand 
      FROM values_items 
      ORDER BY brand ASC
    `);
    res.json(results.map((row) => row.brand));
  } catch (error) {
    console.error("Error fetching brands:", error);
    res.status(500).json({ message: "Error fetching brands" });
  }
});

router.get("/categories", async (req, res) => {
  try {
    const [results] = await pool.query(`
      SELECT DISTINCT category 
      FROM values_items 
      ORDER BY category ASC
    `);
    res.json(results.map((row) => row.category));
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ message: "Error fetching categories" });
  }
});

router.get("/ranks", async (req, res) => {
  try {
    const [results] = await pool.query(`
      SELECT DISTINCT 
        CASE 
          WHEN rank = 'N' THEN 'N'
          WHEN rank = 'S' THEN 'S'
          WHEN rank = 'AB' THEN 'AB'
          WHEN rank = 'A' THEN 'A'
          WHEN rank = 'BC' THEN 'BC'
          WHEN rank = 'B' THEN 'B'
          WHEN rank = 'C' THEN 'C'
          WHEN rank = 'D' THEN 'D'
          WHEN rank = 'E' THEN 'E'
          WHEN rank = 'F' THEN 'F'
          ELSE 'N'
        END as rank,
        COUNT(*) as count
      FROM values_items
      GROUP BY 
        CASE 
          WHEN rank = 'N' THEN 'N'
          WHEN rank = 'S' THEN 'S'
          WHEN rank = 'AB' THEN 'AB'
          WHEN rank = 'A' THEN 'A'
          WHEN rank = 'BC' THEN 'BC'
          WHEN rank = 'B' THEN 'B'
          WHEN rank = 'C' THEN 'C'
          WHEN rank = 'D' THEN 'D'
          WHEN rank = 'E' THEN 'E'
          WHEN rank = 'F' THEN 'F'
          ELSE 'N'
        END
      ORDER BY 
        FIELD(rank, 'N', 'S', 'A', 'AB', 'B', 'BC', 'C', 'D', 'E', 'F')
    `);
    res.json(results);
  } catch (error) {
    console.error("Error fetching ranks:", error);
    res.status(500).json({ message: "Error fetching ranks" });
  }
});

router.get("/auc-nums", async (req, res) => {
  try {
    const [results] = await pool.query(`
      SELECT auc_num, COUNT(*) as count
      FROM values_items
      WHERE auc_num IS NOT NULL
      GROUP BY auc_num
      ORDER BY auc_num ASC
    `);

    res.json(results);
  } catch (error) {
    console.error("Error fetching auction numbers:", error);
    res.status(500).json({ message: "Error fetching auction numbers" });
  }
});

module.exports = router;
