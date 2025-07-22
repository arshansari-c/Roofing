import express from 'express'
import { login,  Profile, register } from '../controllers/auth.controller.js'
import { CheckAuth } from '../middlewares/CheckAuth.js'
import { EditSupplierDetails, fetchSupplierList, SupplierDetails } from '../controllers/supplier.controller.js'
import { EditFreelancerDetails, fetchFreelancerList, FreelancerDetails,fetchOtherUserDetails ,fetchOtherFreelancerDetails} from '../controllers/freelancer.controller.js'
import { cancelOrder, ConversetionChat, fetchConversationChat, fetchOrders, fetchSelectedOrderDetails, SendOrderToContractor } from '../controllers/conversation.controller.js'

export const AuthRouter = express.Router()

AuthRouter.post('/register',register)
AuthRouter.post('/login',login)
AuthRouter.post('/profile/:token', Profile)
AuthRouter.post('/supplierdetails/:token',SupplierDetails)
AuthRouter.post('/supplierdetailsedit',EditSupplierDetails)
AuthRouter.get('/fetchfreelancerdetail/:seconduser',fetchOtherFreelancerDetails)
AuthRouter.post('/freelancerdetails/:token',FreelancerDetails)
AuthRouter.get("/fetchdetails/:seconduser",fetchOtherUserDetails)
AuthRouter.post('/freelancerdetailedit',EditFreelancerDetails)
AuthRouter.get('/fetchfreelancerlist/:token',fetchFreelancerList)
AuthRouter.get('/fetchsupplierlist/:token',fetchSupplierList)
AuthRouter.post('/sendorder/:token/:contractorId',SendOrderToContractor)
AuthRouter.get('/cancelorder/:orderId',cancelOrder)
AuthRouter.get('/fetchorder/:token',fetchOrders)
AuthRouter.get('/fetchselectedorder/:orderId',fetchSelectedOrderDetails)
AuthRouter.post('/conversationchat/:clientId',ConversetionChat)
AuthRouter.get('/fetchconversationchat/:clientId',fetchConversationChat)
