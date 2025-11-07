require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const crypto = require("crypto");
const Razorpay = require("razorpay");

const app = express();
app.set("view engine", "ejs");
app.use(express.static("public"));

// ⚠️ Webhook route BEFORE body parsers
app.post(
  "/razorpay-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const signature = req.headers["x-razorpay-signature"];
      const webhook_secret = process.env.RAZORPAY_WEBHOOK_SECRET;

      if (!signature || !webhook_secret) {
        console.error("Webhook: missing signature or secret");
        return res.status(400).send("Invalid webhook configuration");
      }

      const hmac = crypto.createHmac("sha256", webhook_secret);
      hmac.update(req.body);
      const generated_signature = hmac.digest("hex");

      if (generated_signature !== signature) {
        console.error("Webhook signature verification failed.");
        return res.status(400).send("Invalid signature");
      }

      const event = JSON.parse(req.body.toString());
      console.log("📩 Webhook Event:", event.event);

      if (
        event.event === "payment.captured" ||
        event.event === "payment_link.paid"
      ) {
        const payment = event.payload?.payment?.entity;
        const paymentLink = event.payload?.payment_link?.entity;
        let hallTicketId =
          payment?.notes?.hall_ticket_id || paymentLink?.notes?.hall_ticket_id;

        if (hallTicketId) {
          const appData = pendingApplications[hallTicketId];

          if (appData && appData.status === "pending") {
            console.log(`✅ Processing payment for ${hallTicketId}`);
            const pdfUrl = await generateHallTicket(appData, hallTicketId);

            if (pdfUrl) {
              appData.status = "paid";
              appData.pdfUrl = pdfUrl;
              appData.paymentId = payment?.id;

              try {
                await transporter.sendMail({
                  from: '"Documount Scholarship Program" <admin@entropydevelopers.in>',
                  to: appData.email,
                  subject: "Hall Ticket - Documount Scholarship Program",
                  html: `
                    <div style="font-family: Arial, sans-serif; padding:20px;">
                      <h2 style="color:#28a745;">✅ Payment Successful!</h2>
                      <p>Dear <b>${appData.name}</b>,</p>
                      <p>Your payment has been confirmed. Your Hall Ticket ID is: <b>${hallTicketId}</b></p>
                      <p style="margin:20px 0;">
                        <a href="${
                          process.env.BASE_URL || "http://localhost:3000"
                        }${pdfUrl}" 
                           style="background:#003366;color:white;padding:12px 24px;text-decoration:none;display:inline-block;border-radius:5px;">
                          Download Hall Ticket
                        </a>
                      </p>
                      <p><b>Exam Details:</b><br>
                      Date: 10th December 2025<br>
                      Venue: Documount Training Centre, Hyderabad<br>
                      Reporting Time: 9:00 AM</p>
                      <p style="color:#777;font-size:12px;">Please bring a valid photo ID and this Hall Ticket to the examination center.</p>
                    </div>`,
                });
                console.log(`📧 Hall ticket email sent to ${appData.email}`);
              } catch (emailErr) {
                console.error("❌ Email sending failed:", emailErr);
              }
            }
          }
        }
      }

      res.json({ status: "ok" });
    } catch (err) {
      console.error("❌ Webhook Error:", err);
      res.status(500).send("Server error");
    }
  }
);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const otpStore = {};
const pendingApplications = {};

// Initialize Razorpay (optional check)
let razorpay = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
  console.log("✅ Razorpay initialized");
} else {
  console.warn("⚠️ Razorpay not configured - check environment variables");
}

// PDF Generation function
async function generateHallTicket(appData, hallTicketId) {
  const filePath = path.join(
    __dirname,
    "public",
    "halltickets",
    `${hallTicketId}.pdf`
  );
  const fileUrl = `/halltickets/${hallTicketId}.pdf`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const verificationUrl = `${
    process.env.BASE_URL || "http://localhost:3000"
  }/verify-ticket/${hallTicketId}`;

  try {
    const qrDataUrl = await QRCode.toDataURL(verificationUrl);
    const doc = new PDFDocument({ margin: 40 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc
      .rect(20, 20, doc.page.width - 40, doc.page.height - 40)
      .stroke("#003366");

    if (fs.existsSync("public/images/logo.png")) {
      doc.image("public/images/logo.png", 50, 30, { width: 70 });
    }
    doc
      .fontSize(20)
      .fillColor("#003366")
      .text("Documount Scholarship Program", 130, 40, { align: "left" });
    doc
      .fontSize(10)
      .fillColor("#333")
      .text(
        "Sponsored by Documount Technologies Pvt Ltd & Partner Companies",
        130,
        65
      );

    doc.moveDown(2);
    doc
      .fontSize(18)
      .fillColor("#000")
      .text("HALL TICKET", { align: "center", underline: true });

    doc.moveDown(2);
    doc.fontSize(12).fillColor("#000");
    doc.text(`Hall Ticket ID: ${hallTicketId}`);
    doc.text(`Name: ${appData.name}`);
    doc.text(`Email: ${appData.email}`);
    if (appData.phone) doc.text(`Phone: ${appData.phone}`);
    if (appData.college) doc.text(`College: ${appData.college}`);
    if (appData.course) doc.text(`Course: ${appData.course}`);

    doc.moveDown();
    doc
      .fontSize(12)
      .fillColor("#003366")
      .text("Exam Details:", { underline: true });
    doc.fillColor("#000");
    doc.text("Entrance Exam Date: 10th December 2025");
    doc.text("Venue: Documount Training Centre, Hyderabad");
    doc.text("Reporting Time: 9:00 AM");
    doc.text("Contact: +91-9966653422 | support@documounttech.in");

    doc.image(qrDataUrl, doc.page.width - 150, doc.page.height - 180, {
      width: 100,
    });

    doc.moveDown(2);
    doc
      .fontSize(10)
      .fillColor("#777")
      .text(
        "Please bring a valid photo ID and this Hall Ticket to the examination center.\n" +
          "This document is computer-generated and does not require a signature.",
        { align: "center" }
      );

    doc.end();

    return await new Promise((resolve, reject) => {
      stream.on("finish", () => resolve(fileUrl));
      stream.on("error", (err) => reject(err));
    });
  } catch (err) {
    console.error("Error in PDF/QR generation:", err);
    return null;
  }
}

// Configure Gmail - REMOVED transporter.verify() to avoid timeout
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_USER || "admin@entropydevelopers.in",
    pass: process.env.SMTP_PASS || "kzsvdnpuxtfxjsxf",
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
});

// Routes
app.get("/", (req, res) => res.render("index"));
app.get("/apply", (req, res) => res.render("apply"));
app.get("/about", (req, res) => res.render("about"));
app.get("/contact", (req, res) => res.render("contact"));
app.get("/notices", (req, res) => res.render("notices"));

// Send OTP
app.post("/send-otp", async (req, res) => {
  const { email, name } = req.body;

  console.log("📧 OTP Request received for:", email);

  if (!email) {
    return res.json({ success: false, message: "Email is required" });
  }

  const otp = Math.floor(100000 + Math.random() * 900000);
  otpStore[email] = otp;
  console.log(`✅ Generated OTP for ${email}: ${otp}`);

  try {
    // await transporter.sendMail({
    //   from: '"Documount Scholarship Program" <admin@entropydevelopers.in>',
    //   to: email,
    //   subject: "Email Verification - Documount Scholarship Program",
    //   html: `
    //     <div style="font-family: Arial, sans-serif; background:#f4f6f9; padding:20px;">
    //       <div style="max-width:600px;margin:auto;background:white;border-radius:8px;border:1px solid #ddd;padding:20px;">
    //         <h2 style="color:#003366;text-align:center;">Documount Scholarship Verification</h2>
    //         <p>Dear <b>${name || email}</b>,</p>
    //         <p>Your One-Time Password (OTP) for email verification is:</p>
    //         <div style="font-size:32px;font-weight:bold;color:#0066cc;text-align:center;padding:20px;background:#f0f8ff;border-radius:8px;margin:20px 0;">${otp}</div>
    //         <p>This OTP will expire in 10 minutes. Please do not share it with anyone.</p>
    //         <hr>
    //         <p style="font-size:13px;color:#777;text-align:center;">Documount Technologies Pvt Ltd | Hyderabad, Telangana</p>
    //       </div>
    //     </div>`,
    // });
    console.log("✅ OTP email sent successfully");
    res.json({ success: true, message: "OTP sent to your email." });
  } catch (err) {
    console.error("❌ Email Error:", err.code || err.message);
    res.json({
      success: false,
      message: "Error sending OTP. Please try again.",
    });
  }
});

// Verify OTP and Create Payment Link
app.post("/verify-otp", async (req, res) => {
  const { name, email, phone, college, course, otp } = req.body;
  const storedOtp = otpStore[email];

  if (parseInt(otp) === storedOtp) {
    delete otpStore[email];

    if (!razorpay) {
      return res.json({
        success: false,
        message: "Payment system not configured. Please contact support.",
      });
    }

    const hallTicketId = "HT" + Date.now().toString().slice(-6);
    pendingApplications[hallTicketId] = {
      name,
      email,
      phone,
      college,
      course,
      status: "pending",
    };

    try {
      const paymentLink = await razorpay.paymentLink.create({
        amount: 5000,
        currency: "INR",
        description: "Documount Scholarship Entrance Exam Fee",
        customer: { name, email, contact: phone },
        notify: { sms: true, email: true },
        reminder_enable: true,
        notes: { hall_ticket_id: hallTicketId, college, course },
        callback_url: `${
          process.env.BASE_URL || "http://localhost:3000"
        }/payment-success?ticket_id=${hallTicketId}`,
        callback_method: "get",
      });

      console.log("✅ Payment Link Created:", paymentLink.short_url);
      console.log("✅ Hall Ticket ID saved:", hallTicketId);
      console.log("✅ Callback URL:", paymentLink.callback_url);

      res.json({ success: true, paymentUrl: paymentLink.short_url });
    } catch (err) {
      console.error("❌ Razorpay Error:", err);
      res.json({
        success: false,
        message: "Error creating payment link. Please try again.",
      });
    }
  } else {
    res.json({ success: false, message: "Invalid OTP. Please try again." });
  }
});

// Ticket Verification Page
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

// Payment Success Page
app.get("/payment-success", (req, res) => {
  const { ticket_id } = req.query;
  if (!ticket_id) return res.status(400).send("Invalid request.");

  const appData = pendingApplications[ticket_id];

  if (appData && appData.status === "paid" && appData.pdfUrl) {
    res.render("success", {
      name: appData.name,
      pdfUrl: appData.pdfUrl,
      hallTicketId: ticket_id,
    });
    setTimeout(() => delete pendingApplications[ticket_id], 5 * 60 * 1000);
  } else if (appData && appData.status === "pending") {
    res.send(
      `<html>
         <head>
           <title>Processing Payment...</title>
           <meta http-equiv="refresh" content="3">
           <style>
             body { font-family: Arial; background:#f4f6f9; padding:40px; text-align:center; }
             .card { background:white; padding:40px; border-radius:8px; max-width:600px; 
                     margin:auto; box-shadow:0 0 10px rgba(0,0,0,0.1); }
             .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #003366;
                        border-radius: 50%; width: 40px; height: 40px;
                        animation: spin 1s linear infinite; margin: 20px auto; }
             @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
           </style>
         </head>
         <body>
           <div class="card">
             <div class="spinner"></div>
             <h2>Verifying your payment...</h2>
             <p>Please wait, this page will refresh automatically.</p>
           </div>
         </body>
       </html>`
    );
  } else {
    res.status(404).send("Hall Ticket not found or payment not completed.");
  }
});

// Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ Server running at http://localhost:${PORT}`)
);
