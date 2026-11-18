# Gold Blog Backend (Node.js + Express + MySQL)

A minimal, clean, and zero-junk-code backend for the Gold Detector Blog.

## 🚀 Features
- **Node.js + Express.js**
- **MySQL (`mysql2`)** with connection pooling
- Single table: `blogs`
- Table & database are **auto-created** on startup (if not exists)
- Initial sample data is **auto-seeded** on first run
- **`content` column uses `LONGTEXT`** to fully support HTML rich text (from CKEditor, Quill, TinyMCE, or TipTap) as well as structured JSON array of paragraphs
- No bloated folders or over-engineered boilerplate

---

## ⚙️ Configuration

Check `.env` file and set your MySQL password if you have one:
```env
PORT=5000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=gold_blog_db
```

---

## 🏃 Run

```bash
# Start development server
npm run dev

# Or start normal
npm start
```

---

## 📡 API Endpoints

### 1. Get All Blogs
- **Endpoint:** `GET http://localhost:5000/api/blogs`
- **Optional filters:**
  - `GET http://localhost:5000/api/blogs?category=Trending`
  - `GET http://localhost:5000/api/blogs?tag=Trending`
- **Response:**
```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "id": 1,
      "title": "How Treasure Hunting Changed My Life",
      "subtitle": "A true story lorum ipsum",
      "readTime": "5 min read",
      "date": "May 12, 2024",
      "category": "Trending",
      "tags": ["All", "Trending"],
      "image": "https://images.unsplash.com/...",
      "content": [
        "Lorem ipsum dolor sit amet...",
        "Gold travels along the path of least resistance..."
      ],
      "createdAt": "2026-09-11T..."
    }
  ]
}
```

### 2. Get Single Blog By ID
- **Endpoint:** `GET http://localhost:5000/api/blogs/:id`
- **Response:** Single blog with full detail/HTML content for the blog detail page.

### 3. Create a Blog
- **Endpoint:** `POST http://localhost:5000/api/blogs`
- **Body:**
```json
{
  "title": "Top 10 tips to find gold like a PRO hunter",
  "subtitle": "Essential tips for gold prospectors",
  "readTime": "5 min read",
  "date": "May 12, 2024",
  "category": "Trending",
  "tags": ["All", "Trending"],
  "image": "https://example.com/banner.jpg",
  "content": "<p>Lorem ipsum dolor sit amet... <strong>Gold tips</strong></p>"
}
```
*(Notice: `content` can be either raw HTML string or an array of strings/paragraphs!)*

### 4. Delete a Blog
- **Endpoint:** `DELETE http://localhost:5000/api/blogs/:id`
