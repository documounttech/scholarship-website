
const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");

const app = express();
app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const otpStore = {};

// 🔹 Configure your Gmail
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "admin@entropydevelopers.in", // <-- replace with your Gmail
    pass: "kzsvdnpuxtfxjsxf",          // <-- use 16-char app password from Google
  },
});

// 🏠 Home Route
app.get("/", (req, res) => res.render("index"));

// 📝 Apply Page
app.get("/apply", (req, res) => res.render("apply"));

// About Us page
app.get("/about", (req, res) => res.render("about"));

// Contact page
app.get("/contact", (req, res) => res.render("contact"));
// Public Notices page
app.get("/notices", (req, res) => res.render("notices"));


// 📩 Send OTP to Email
app.post("/send-otp", async (req, res) => {
  const { email } = req.body;
  const otp = Math.floor(100000 + Math.random() * 900000);
  otpStore[email] = otp;

  try {
    await transporter.sendMail({
      from: '"Documount Scholarship Program" <admin@entropydevelopers.in>',
      to: email,
      subject: "Email Verification - Documount Scholarship Program",
      html: `
        <div style="font-family: Arial, sans-serif; background:#f4f6f9; padding:20px;">
          <div style="max-width:600px;margin:auto;background:white;border-radius:8px;border:1px solid #ddd;padding:20px;">
            <h2 style="color:#003366;text-align:center;">Documount Scholarship Verification</h2>
            <p>Dear <b>${email}</b>,</p>
            <p>Your One-Time Password (OTP) for email verification is:</p>
            <div style="font-size:24px;font-weight:bold;color:#0066cc;text-align:center;">${otp}</div>
            <p>This OTP will expire in 10 minutes. Please do not share it with anyone.</p>
            <hr>
            <p style="font-size:13px;color:#777;text-align:center;">Documount Technologies Pvt Ltd | Hyderabad, Telangana</p>
          </div>
        </div>`
    });
    res.json({ success: true, message: "OTP sent to your email." });
  } catch (err) {
    console.error("Email Error:", err);
    res.json({ success: false, message: "Error sending OTP. Please check email settings." });
  }
});

// ✅ Verify OTP and Generate Hall Ticket (with QR Code)
app.post("/verify-otp", (req, res) => {
  const { name, email, phone, college, course, otp } = req.body;
  const storedOtp = otpStore[email];

  if (parseInt(otp) === storedOtp) {
    delete otpStore[email];

    const hallTicketId = "HT" + Date.now().toString().slice(-6);
    const filePath = path.join(__dirname, "public", "halltickets", `${hallTicketId}.pdf`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    // Generate QR code (async handled via callback)
    const verificationUrl = `http://localhost:3000/verify-ticket/${hallTicketId}`;

    QRCode.toDataURL(verificationUrl)
      .then((qrDataUrl) => {
        const doc = new PDFDocument({ margin: 40 });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        // Border
        doc.rect(20, 20, doc.page.width - 40, doc.page.height - 40).stroke("#003366");

        // Logo + Header
        if (fs.existsSync("public/images/logo.png")) {
          doc.image("public/images/logo.png", 50, 30, { width: 70 });
        }
        doc.fontSize(20).fillColor("#003366").text("Documount Scholarship Program", 130, 40, { align: "left" });
        doc.fontSize(10).fillColor("#333").text("Sponsored by Documount Technologies Pvt Ltd & Partner Companies", 130, 65);

        // Title
        doc.moveDown(2);
        doc.fontSize(18).fillColor("#000").text("HALL TICKET", { align: "center", underline: true });

        // Student Info
        doc.moveDown(2);
        doc.fontSize(12).fillColor("#000");
        doc.text(`Hall Ticket ID: ${hallTicketId}`);
        doc.text(`Name: ${name}`);
        doc.text(`Email: ${email}`);
        doc.text(`Phone: ${phone}`);
        doc.text(`College: ${college}`);
        doc.text(`Course: ${course}`);

        // Exam Details
        doc.moveDown();
        doc.fontSize(12).fillColor("#003366").text("Exam Details:", { underline: true });
        doc.fillColor("#000");
        doc.text("Entrance Exam Date: 10th December 2025");
        doc.text("Venue: Documount Training Centre, Hyderabad");
        doc.text("Reporting Time: 9:00 AM");
        doc.text("Contact: +91-9966653422 | support@documounttech.in");

        // QR Code
        doc.image(qrDataUrl, doc.page.width - 150, doc.page.height - 180, { width: 100 });

        // Footer
        doc.moveDown(2);
        doc.fontSize(10).fillColor("#777").text(
          "Please bring a valid photo ID and this Hall Ticket to the examination center.\n" +
          "This document is computer-generated and does not require a signature.",
          { align: "center" }
        );

        doc.end();

        stream.on("finish", () => {
          res.json({ success: true, link: `/halltickets/${hallTicketId}.pdf` });
        });
      })
      .catch((err) => {
        console.error("QR Generation Error:", err);
        res.json({ success: false, message: "Error generating Hall Ticket." });
      });
  } else {
    res.json({ success: false, message: "Invalid OTP. Please try again." });
  }
});

// 🔹 Ticket Verification Page
app.get("/verify-ticket/:id", (req, res) => {
  const { id } = req.params;
  res.send(`
    <html>
      <head>
        <title>Verify Hall Ticket</title>
        <style>
          body { font-family: Arial; background:#f2f2f2; padding:40px; }
          .card { background:white; padding:30px; border-radius:8px; max-width:600px; margin:auto;
                  box-shadow:0 0 10px rgba(0,0,0,0.1); }
          h2 { color:#003366; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Documount Scholarship Program - Hall Ticket Verification</h2>
          <p><b>Hall Ticket ID:</b> ${id}</p>
          <p>This Hall Ticket is <b>valid</b> and issued by Documount Technologies Pvt Ltd.</p>
          <p>Please verify the student's ID proof at the examination center.</p>
          <p><i>Issued under Industry-Integrated Scholarship Program, Hyderabad.</i></p>
        </div>
      </body>
    </html>
  `);
});

// Server
const PORT = 3000;
app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
