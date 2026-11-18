import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { getPool, initDB } from "./db.js";
import { startAgent } from "./agent/index.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Helper to format blog response (clean parsing of tags & HTML/JSON content)
const formatBlog = (blog) => {
  if (!blog) return null;

  let tags = [];
  try {
    tags = typeof blog.tags === "string" ? JSON.parse(blog.tags) : blog.tags || [];
  } catch {
    tags = blog.tags ? [blog.tags] : [];
  }

  let content = blog.content;
  try {
    // If stored as JSON array/object, parse it; otherwise return raw HTML string
    const parsed = JSON.parse(blog.content);
    if (parsed) content = parsed;
  } catch {
    content = blog.content; // Raw HTML / markdown / string
  }

  return {
    id: blog.id,
    title: blog.title,
    subtitle: blog.subtitle,
    readTime: blog.readTime,
    date: blog.date,
    category: blog.category,
    tags,
    image: blog.image,
    content,
    createdAt: blog.createdAt
  };
};

// ---------------------- ROUTES (CONTROLLER LOGIC INSIDE) ---------------------- //

// 1. GET all blogs (supports optional ?category= or ?tag= query filter)
app.get("/api/blogs", async (req, res) => {
  try {
    const db = getPool();
    const { category, tag } = req.query;
    let query = "SELECT * FROM blogs ORDER BY id DESC";
    let params = [];

    if (category && category.toLowerCase() !== "all") {
      query = "SELECT * FROM blogs WHERE LOWER(category) = LOWER(?) ORDER BY id DESC";
      params = [category];
    } else if (tag && tag.toLowerCase() !== "all") {
      query = "SELECT * FROM blogs WHERE JSON_CONTAINS(tags, ?) ORDER BY id DESC";
      params = [JSON.stringify(tag)];
    }

    const [rows] = await db.query(query, params);
    const blogs = rows.map(formatBlog);

    return res.status(200).json({
      success: true,
      count: blogs.length,
      data: blogs
    });
  } catch (error) {
    console.error("Error fetching blogs:", error);
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

// 2. GET single blog by ID (For blog detail page)
app.get("/api/blogs/:id", async (req, res) => {
  try {
    const db = getPool();
    const { id } = req.params;
    const [rows] = await db.query("SELECT * FROM blogs WHERE id = ?", [id]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Blog not found" });
    }

    return res.status(200).json({
      success: true,
      data: formatBlog(rows[0])
    });
  } catch (error) {
    console.error("Error fetching blog:", error);
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

// 3. POST create a new blog (content can be raw HTML string or array of strings)
app.post("/api/blogs", async (req, res) => {
  try {
    const db = getPool();
    const { title, subtitle, readTime, date, category, tags, image, content } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, message: "Title is required" });
    }

    const formattedTags = Array.isArray(tags) ? JSON.stringify(tags) : JSON.stringify(tags ? [tags] : []);
    const formattedContent = typeof content === "object" ? JSON.stringify(content) : (content || "");

    const [result] = await db.query(
      `INSERT INTO blogs (title, subtitle, readTime, date, category, tags, image, content)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        subtitle || "",
        readTime || "5 min read",
        date || new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        category || "Trending",
        formattedTags,
        image || "",
        formattedContent
      ]
    );

    const [newRow] = await db.query("SELECT * FROM blogs WHERE id = ?", [result.insertId]);

    return res.status(201).json({
      success: true,
      message: "Blog created successfully",
      data: formatBlog(newRow[0])
    });
  } catch (error) {
    console.error("Error creating blog:", error);
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

// 4. DELETE blog by ID
app.delete("/api/blogs/:id", async (req, res) => {
  try {
    const db = getPool();
    const { id } = req.params;
    const [result] = await db.query("DELETE FROM blogs WHERE id = ?", [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Blog not found" });
    }

    return res.status(200).json({ success: true, message: "Blog deleted successfully" });
  } catch (error) {
    console.error("Error deleting blog:", error);
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

// Start server and initialize database
app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  await initDB();
  startAgent();
});
