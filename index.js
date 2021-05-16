
require('dotenv').config();

const express = require('express');
const app = express();

const limiter = require('express-rate-limit')({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 15 // limit each IP to 15 requests per windowMs
});

app.use(limiter);
app.use(express.json());

app.use(require('cors')({
    origin: "*"
}));

app.all("/", (req, res) => res.redirect("https://c2n.srg.id.au"))
app.use("/actions/assn2db", require('./actions/assignments_to_db'));

app.listen(process.env.PORT || 8080)