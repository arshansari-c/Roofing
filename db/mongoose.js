import mongoose from "mongoose"

export default async function mongoDB(){
    try {
       await mongoose.connect(process.env.MONGODB_URI)
        console.log("database connect succsfully")
    } catch (error) {
        console.log("mongodb error",error)
    }
}