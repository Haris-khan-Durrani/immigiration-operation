import mysql from 'mysql2/promise';
export const db = mysql.createPool({host:process.env.MYSQL_HOST || '127.0.0.1',port:Number(process.env.MYSQL_PORT || 3306),database:process.env.MYSQL_DATABASE || 'operations',user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,connectionLimit:10,jsonStrings:true,dateStrings:['DATE']});
