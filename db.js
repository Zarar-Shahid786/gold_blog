import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || ""
};

const dbName = process.env.DB_NAME || "gold_blog_db";

// Connection pool
let pool = null;

export const getPool = () => {
  if (!pool) {
    pool = mysql.createPool({
      ...dbConfig,
      database: dbName,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
  }
  return pool;
};

// Auto-initialize Database, Table, and Seed Data
export const initDB = async () => {
  try {
    // 1. Ensure database exists
    const rootConn = await mysql.createConnection(dbConfig);
    await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
    await rootConn.end();

    const db = getPool();

    // 2. Ensure table exists
    // Note: 'content' uses LONGTEXT so it supports raw HTML, rich text, or JSON
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS blogs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        subtitle VARCHAR(255) DEFAULT '',
        readTime VARCHAR(50) DEFAULT '5 min read',
        date VARCHAR(50) DEFAULT '',
        category VARCHAR(100) DEFAULT 'Trending',
        tags JSON,
        image LONGTEXT,
        content LONGTEXT,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    await db.query(createTableQuery);

    // 3. Seed initial blog data if table is empty
    const [rows] = await db.query("SELECT COUNT(*) as count FROM blogs");
    if (rows[0].count === 0) {
      const seedBlog = {
        title: "How Treasure Hunting Changed My Life",
        subtitle: "A true story lorum ipsum",
        readTime: "5 min read",
        date: "May 12, 2024",
        category: "Trending",
        tags: JSON.stringify(["All", "Trending"]),
        image: "https://images.unsplash.com/photo-1610375461246-83df859d849d?q=80&w=1200&auto=format&fit=crop",
        // Content supports HTML or array of paragraphs
        content: JSON.stringify([
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
          "Gold travels along the path of least resistance until heavy obstacles catch it. Bedrock cracks, tree roots, and large boulders in natural gold streams act as natural sluice boxes.",
          "Always inspect gravel pockets that sit directly atop solid slate or bedrock surfaces."
        ])
      };

      await db.query(
        `INSERT INTO blogs (title, subtitle, readTime, date, category, tags, image, content) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          seedBlog.title,
          seedBlog.subtitle,
          seedBlog.readTime,
          seedBlog.date,
          seedBlog.category,
          seedBlog.tags,
          seedBlog.image,
          seedBlog.content
        ]
      );
      console.log("✅ Seed blog post added to MySQL database!");
    }

    console.log("✅ MySQL Database and 'blogs' table are ready!");
  } catch (error) {
    console.error("❌ MySQL initialization error:", error.message);
  }
};

export default { getPool, initDB };
