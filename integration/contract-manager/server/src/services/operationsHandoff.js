const {createService}=require('./operationsHandoffService');
module.exports=createService({db:require('../config/db'),ghlService:require('./ghlService')});
